/**
 * Browser half of the practical-frontend bundle.
 *
 * One feature: give each Workspace row in the sidebar a background tint, chosen
 * from the row's own "…" menu, so a long project list stays readable.
 *
 * Three cooperating pieces:
 *  - a stylesheet keyed on the row's `data-row-key` attribute (no DOM surgery),
 *  - a row appended to the shipped rename/delete menu of a project row,
 *  - a popover registered into `shell.overlay` that holds the palette.
 *
 * The menu row and the row lookup are the only places that read shipped markup:
 * they follow the published row contract (`data-row-key`, the two action
 * buttons, the menu's `role="menu"` surface) and degrade to a silent no-op when
 * a future release changes it, so an upgrade can never break the sidebar.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-practical-frontend',
  factory(require) {
    const React = require('react');

    /** Client locale namespace and the Host endpoint this package owns. */
    const NS = 'dsh-practical-frontend';
    const ENDPOINT = '/dsh-practical-frontend/project-colors';
    /** Attribute on a sidebar group row; its value is the Workspace id. */
    const ROW_PREFIX = 'workspace:';
    /** Marks the row this plugin appended to a shipped menu. */
    const ITEM_ATTRIBUTE = 'data-dsh-practical-frontend-item';
    const POPOVER_ID = 'practical-frontend-project-colors';
    const STYLE_ATTRIBUTE = 'data-dsh-practical-frontend';
    const POPOVER_STYLE_ATTRIBUTE = 'data-dsh-practical-frontend-popover';
    /** Rough card width, used only to keep it inside the viewport. */
    const POPOVER_WIDTH = 176;
    const LOOKUP_TIMEOUT_MS = 600;
    const LOOKUP_INTERVAL_MS = 24;

    const TEXTS = {
      zh: {
        menuLabel: '项目颜色',
        title: '项目颜色',
        red: '红色',
        orange: '橙色',
        amber: '黄色',
        green: '绿色',
        teal: '青色',
        blue: '蓝色',
        indigo: '靛色',
        pink: '粉色',
        none: '无颜色',
      },
      en: {
        menuLabel: 'Project color',
        title: 'Project color',
        red: 'Red',
        orange: 'Orange',
        amber: 'Yellow',
        green: 'Green',
        teal: 'Teal',
        blue: 'Blue',
        indigo: 'Indigo',
        pink: 'Pink',
        none: 'No color',
      },
    };

    /**
     * Palette entries are hue triples only: the row background is that hue at a
     * low alpha over whatever the theme paints, so label contrast survives both
     * light and dark themes instead of being decided by a literal colour.
     */
    const PALETTE = [
      { id: 'red', rgb: '229, 72, 77' },
      { id: 'orange', rgb: '247, 107, 21' },
      { id: 'amber', rgb: '255, 178, 36' },
      { id: 'green', rgb: '48, 164, 108' },
      { id: 'teal', rgb: '18, 165, 148' },
      { id: 'blue', rgb: '0, 145, 255' },
      { id: 'indigo', rgb: '94, 106, 210' },
      { id: 'pink', rgb: '214, 64, 159' },
    ];

    /** Row tint and hover tint, as a fraction of the chosen hue. */
    const TINT_REST = 0.18;
    const TINT_HOVER = 0.3;

    const POPOVER_CSS = `
.dsh-pf-pop{pointer-events:auto;position:fixed;z-index:30;box-sizing:border-box;padding:12px;border-radius:var(--dsw-radius-lg,12px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-shadow:0 12px 32px rgb(0 0 0 / 12%),0 2px 8px rgb(0 0 0 / 6%)}
.dsh-pf-pop__title{margin-bottom:10px;color:var(--dsw-alias-label-secondary)}
.dsh-pf-pop__grid{display:grid;grid-template-columns:repeat(5,20px);gap:10px}
.dsh-pf-pop__swatch{box-sizing:border-box;display:grid;place-items:center;width:20px;height:20px;padding:0;border:2px solid transparent;border-radius:999px;background:transparent;cursor:pointer;transition:border-color .15s ease,opacity .15s ease}
.dsh-pf-pop__swatch:hover{opacity:.85}
.dsh-pf-pop__swatch[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2)}
`;

    /**
     * Insert or update one stylesheet element in the document head.
     *
     * @param css - stylesheet text.
     * @param attribute - data attribute identifying the element.
     * @returns the element, for later updates and removal.
     */
    function insertStyle(css, attribute) {
      const existing = document.head.querySelector(`style[${attribute}]`);
      if (existing !== null) {
        existing.textContent = css;
        return existing;
      }
      const element = document.createElement('style');
      element.setAttribute(attribute, '');
      element.textContent = css;
      document.head.appendChild(element);
      return element;
    }

    /**
     * Escape a value for use inside a double-quoted attribute selector.
     *
     * @param value - raw attribute value.
     * @returns the escaped value.
     */
    function escapeAttribute(value) {
      return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Build the menu-row icon: a half-filled circle, the "tint" mark.
     *
     * @returns an SVG element sized like the shipped menu icons.
     */
    function tintIcon() {
      const namespace = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const ring = document.createElementNS(namespace, 'circle');
      ring.setAttribute('cx', '8');
      ring.setAttribute('cy', '8');
      ring.setAttribute('r', '5.25');
      ring.setAttribute('stroke', 'currentColor');
      ring.setAttribute('stroke-width', '1.5');
      const half = document.createElementNS(namespace, 'path');
      half.setAttribute('d', 'M8 2.75a5.25 5.25 0 0 1 0 10.5Z');
      half.setAttribute('fill', 'currentColor');
      svg.append(ring, half);
      return svg;
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const fallback = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
          ? TEXTS.zh
          : TEXTS.en;
        let locale;
        try {
          locale = ctx.get('locale');
        } catch {
          locale = undefined;
        }
        if (locale !== undefined && locale !== null) {
          ctx.effect(() => {
            const disposers = Object.entries(TEXTS).map(([id, dictionary]) => {
              try {
                return locale.register(NS, id, dictionary);
              } catch (error) {
                console.error('practical-frontend: locale dictionary registration failed', error);
                return undefined;
              }
            });
            return () => {
              for (const dispose of disposers) {
                try {
                  dispose?.();
                } catch {
                  // A disposed namespace is already gone; nothing to unwind.
                }
              }
            };
          }, 'practical-frontend: locale dictionaries');
        }
        /**
         * Read one label in the active locale. Rebinding per call keeps a label
         * that opens rarely (a menu row, a popover) in step with a locale switch.
         *
         * @param key - key in this package's namespace.
         * @returns the localized text, or the fallback dictionary's text.
         */
        const translate = (key) => {
          if (locale !== undefined && locale !== null) {
            try {
              const bound = locale.bind(NS);
              const text = bound(key);
              if (typeof text === 'string' && text !== '') return text;
            } catch {
              // Fall through to the packaged dictionary.
            }
          }
          return fallback[key] ?? key;
        };

        const colors = {};
        const listeners = new Set();
        const overlay = { open: false, workspaceId: '', name: '', rect: null };
        let pendingTrigger = null;
        const rowStyle = insertStyle('', STYLE_ATTRIBUTE);
        insertStyle(POPOVER_CSS, POPOVER_STYLE_ATTRIBUTE);

        ctx.effect(() => () => {
          rowStyle.remove();
          document.head.querySelector(`style[${POPOVER_STYLE_ATTRIBUTE}]`)?.remove();
        }, 'practical-frontend: stylesheets');

        const emit = () => {
          for (const listener of listeners) listener();
        };

        /** Repaint the row tint rules from the current colour map. */
        const paint = () => {
          const rules = [];
          for (const [workspaceId, colorId] of Object.entries(colors)) {
            const chip = PALETTE.find((entry) => entry.id === colorId);
            if (chip === undefined) continue;
            const selector = `[data-row-key="${ROW_PREFIX}${escapeAttribute(workspaceId)}"]`;
            rules.push(`${selector}{background:rgba(${chip.rgb},${TINT_REST}) !important}`);
            rules.push(`${selector}:hover{background:rgba(${chip.rgb},${TINT_HOVER}) !important}`);
          }
          rowStyle.textContent = rules.join('');
        };

        const openOverlay = (workspaceId, name, rect) => {
          overlay.open = true;
          overlay.workspaceId = workspaceId;
          overlay.name = name;
          overlay.rect = rect;
          emit();
        };

        const closeOverlay = () => {
          if (overlay.open === false) return;
          overlay.open = false;
          emit();
        };

        /**
         * Read the stored colour map from this package's Host half.
         */
        const refresh = async () => {
          try {
            const response = await fetch(ENDPOINT, { cache: 'no-store' });
            if (response.ok === false) return;
            const type = response.headers.get('content-type') ?? '';
            if (!type.includes('application/json')) return;
            const body = await response.json();
            const stored = body !== null && typeof body === 'object' ? body.colors : undefined;
            if (stored === null || typeof stored !== 'object') return;
            for (const key of Object.keys(colors)) delete colors[key];
            for (const [key, value] of Object.entries(stored)) {
              if (typeof value === 'string') colors[key] = value;
            }
            paint();
          } catch (error) {
            console.error('practical-frontend: reading workspace colours failed', error);
          }
        };

        /**
         * Paint one colour change immediately, then hand it to the Host half.
         *
         * @param workspaceId - Workspace whose row changes.
         * @param colorId - palette id, or null to clear the tint.
         */
        const persist = async (workspaceId, colorId) => {
          if (colorId === null) delete colors[workspaceId];
          else colors[workspaceId] = colorId;
          paint();
          emit();
          try {
            await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspaceId, color: colorId }),
            });
          } catch (error) {
            console.error('practical-frontend: saving the workspace colour failed', error);
          }
        };

        /**
         * The palette popover. It stays open after a pick so colours can be
         * compared and adjusted, and closes on Escape, outside press, or scroll.
         *
         * @returns the popover, or null while closed.
         */
        function ProjectColorPopover() {
          const [, setVersion] = React.useState(0);
          const card = React.useRef(null);
          const open = overlay.open;
          const workspaceId = overlay.workspaceId;
          const selected = colors[workspaceId];

          React.useEffect(() => {
            const listener = () => setVersion((value) => value + 1);
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          }, []);

          React.useEffect(() => {
            if (open === false) return undefined;
            const onPointerDown = (event) => {
              if (card.current !== null && event.target instanceof Node && card.current.contains(event.target)) return;
              closeOverlay();
            };
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              closeOverlay();
            };
            const onScroll = () => closeOverlay();
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('scroll', onScroll, true);
            return () => {
              document.removeEventListener('pointerdown', onPointerDown, true);
              document.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('scroll', onScroll, true);
            };
          }, [open]);

          if (overlay.open === false || overlay.rect === null) return null;
          const rect = overlay.rect;
          const left = Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - POPOVER_WIDTH - 8));
          const top = Math.min(Math.round(rect.bottom + 6), Math.max(8, window.innerHeight - 120));
          const swatches = PALETTE.map((chip) => React.createElement('button', {
            key: chip.id,
            type: 'button',
            className: 'dsh-pf-pop__swatch',
            'aria-pressed': selected === chip.id,
            'aria-label': translate(chip.id),
            style: { background: `rgb(${chip.rgb})` },
            onClick: () => {
              void persist(workspaceId, selected === chip.id ? null : chip.id);
            },
          }));
          swatches.push(React.createElement(
            'button',
            {
              key: 'none',
              type: 'button',
              className: 'dsh-pf-pop__swatch',
              'aria-pressed': selected === undefined,
              'aria-label': translate('none'),
              onClick: () => {
                void persist(workspaceId, null);
              },
            },
            React.createElement(
              'svg',
              {
                viewBox: '0 0 20 20',
                width: '100%',
                height: '100%',
                'aria-hidden': 'true',
                focusable: 'false',
              },
              React.createElement('circle', {
                key: 'ring',
                cx: '10',
                cy: '10',
                r: '7.5',
                fill: 'none',
                stroke: 'var(--dsw-alias-label-tertiary)',
                strokeWidth: '1.5',
              }),
              React.createElement('path', {
                key: 'slash',
                d: 'M5.2 14.8 14.8 5.2',
                stroke: 'var(--dsw-alias-label-tertiary)',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
              }),
            ),
          ));
          return React.createElement(
            'div',
            {
              className: 'dsh-pf-pop',
              ref: card,
              role: 'dialog',
              'aria-label': overlay.name === '' ? translate('title') : `${translate('title')} · ${overlay.name}`,
              style: { left: `${left}px`, top: `${top}px` },
            },
            React.createElement('div', { className: 'dsh-pf-pop__title' }, translate('title')),
            React.createElement('div', { className: 'dsh-pf-pop__grid' }, swatches),
          );
        }

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: POPOVER_ID,
          order: 40,
        }, ProjectColorPopover));

        /**
         * Find the project menu that is open right now. Only the rename/delete
         * pair qualifies, which keeps every other menu untouched.
         *
         * @returns the open project menu, or null.
         */
        const findProjectMenu = () => {
          for (const menu of document.querySelectorAll('[data-menu-material][role="menu"]')) {
            if (menu.querySelectorAll('button[role="menuitem"]').length === 2) return menu;
          }
          return null;
        };

        /**
         * Close the shipped menu the way Escape does: the menu owns its open
         * state and listens for that key, and its rows unmount with it.
         */
        const dismissMenu = () => {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          }));
        };

        /**
         * Append this feature's row to the open project menu, copying the shipped
         * rename row so markup, spacing, and hover styling stay the host's.
         *
         * @param menu - the open menu surface.
         * @param trigger - the Workspace row that opened it.
         */
        const enhanceMenu = (menu, trigger) => {
          const rows = menu.querySelectorAll('button[role="menuitem"]');
          const template = rows[0]?.parentElement;
          if (template === undefined || template === null) return;
          const viewport = template.parentElement;
          if (viewport === null) return;
          if (viewport.querySelector(`[${ITEM_ATTRIBUTE}]`) !== null) return;
          const wrap = template.cloneNode(true);
          for (const separator of wrap.querySelectorAll('[role="separator"]')) separator.remove();
          const button = wrap.querySelector('button[role="menuitem"]');
          if (button === null) return;
          button.removeAttribute('aria-keyshortcuts');
          button.removeAttribute('aria-current');
          button.disabled = false;
          const label = button.lastElementChild;
          if (label !== null) label.textContent = translate('menuLabel');
          const icon = button.firstElementChild;
          if (icon !== null && icon !== label) icon.replaceChildren(tintIcon());
          wrap.setAttribute(ITEM_ATTRIBUTE, '');
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dismissMenu();
            openOverlay(trigger.workspaceId, trigger.name, trigger.rect);
          });
          template.after(wrap);
        };

        /**
         * Poll briefly for the menu the clicked trigger opens.
         *
         * @param attempt - poll index.
         */
        const lookupMenu = (attempt) => {
          if (pendingTrigger === null) return;
          const menu = findProjectMenu();
          if (menu !== null) {
            const trigger = pendingTrigger;
            pendingTrigger = null;
            enhanceMenu(menu, trigger);
            return;
          }
          if (attempt * LOOKUP_INTERVAL_MS >= LOOKUP_TIMEOUT_MS) {
            pendingTrigger = null;
            return;
          }
          window.setTimeout(() => lookupMenu(attempt + 1), LOOKUP_INTERVAL_MS);
        };

        /**
         * Record the project row whose "…" button was just pressed, so the menu
         * that opens after it is attributed to that Workspace.
         *
         * @param event - document click, capture phase.
         */
        const onDocumentClick = (event) => {
          if (!(event.target instanceof Element)) return;
          const row = event.target.closest(`[data-row-key^="${ROW_PREFIX}"]`);
          if (row === null) return;
          const actions = row.lastElementChild;
          if (actions === null) return;
          const buttons = actions.querySelectorAll('button');
          if (buttons.length !== 2) return;
          if (event.target.closest('button') !== buttons[0]) return;
          const workspaceId = (row.getAttribute('data-row-key') ?? '').slice(ROW_PREFIX.length);
          if (workspaceId === '') return;
          pendingTrigger = {
            workspaceId,
            rect: row.getBoundingClientRect(),
            name: (row.textContent ?? '').trim().slice(0, 60),
          };
          lookupMenu(0);
        };

        ctx.effect(() => {
          document.addEventListener('click', onDocumentClick, true);
          return () => document.removeEventListener('click', onDocumentClick, true);
        }, 'practical-frontend: project menu rows');

        void refresh();
      },
    };
  },
});
