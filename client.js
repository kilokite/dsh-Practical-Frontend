/**
 * Browser half of the practical-frontend bundle.
 *
 * Two features for the Web GUI:
 *  1. A background tint for each Workspace row in the sidebar, chosen from the
 *     row's own "…" menu.
 *  2. Bookmarks: select any part of a conversation, name it, and find it again
 *     in the sidebar's 书签 panel, grouped by project.
 *
 * The colour feature uses three cooperating pieces:
 *  - a stylesheet keyed on the row's `data-row-key` attribute (no DOM surgery),
 *  - a row appended to the shipped rename/delete menu of a project row,
 *  - a popover registered into `shell.overlay` that holds the palette.
 *
 * The bookmark feature uses the published composition seats rather than the
 * shipped markup: a `sidebar.panellist` row opens a root-scoped `main` panel,
 * and one `shell.overlay` entry owns the selection pill, the editor dialog and
 * transient feedback. The only shipped DOM it reads is the conversation
 * container's `data-conversation-content` / `data-conversation-session`
 * attributes, which are the same stable contract the composer uses.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-practical-frontend',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const {
      Button,
      Input,
      Modal,
      IconCloseOutlineRegular,
      IconEditOutlineRegular,
      IconFolderOpenOutlineRegular,
      IconInspectOutlineRegular,
      IconRefreshOutlineRegular,
      IconSearchOutlineRegular,
      IconTrashOutlineRegular,
      IconWarningTriangleOutlineRegular,
    } = primitives;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

    /** Client locale namespace and the Host endpoints this package owns. */
    const NS = 'dsh-practical-frontend';
    const COLOR_ENDPOINT = '/dsh-practical-frontend/project-colors';
    const BOOKMARK_ENDPOINT = '/dsh-practical-frontend/bookmarks';
    /** Attribute on a sidebar group row; its value is the Workspace id. */
    const ROW_PREFIX = 'workspace:';
    /** Marks the row this plugin appended to a shipped menu. */
    const ITEM_ATTRIBUTE = 'data-dsh-practical-frontend-item';
    const POPOVER_ID = 'practical-frontend-project-colors';
    const BOOKMARK_PANEL_ID = 'practical-frontend-bookmarks';
    const BOOKMARK_PILL_ATTRIBUTE = 'data-dsh-practical-frontend-bookmark-pill';
    const STYLE_ATTRIBUTE = 'data-dsh-practical-frontend';
    const POPOVER_STYLE_ATTRIBUTE = 'data-dsh-practical-frontend-popover';
    const BOOKMARK_STYLE_ATTRIBUTE = 'data-dsh-practical-frontend-bookmarks';
    /** Rough card width, used only to keep it inside the viewport. */
    const POPOVER_WIDTH = 176;
    /** Selection caps mirrored by the Host half. */
    const MAX_TEXT = 20000;
    const MAX_TITLE = 300;
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
        panelLabel: '书签',
        panelTitle: '书签',
        searchPlaceholder: '搜索标题、内容或会话',
        searchLabel: '搜索书签',
        clearSearch: '清除搜索',
        refresh: '刷新书签',
        loading: '正在加载书签…',
        loadFailed: '无法读取书签',
        retry: '重试',
        emptyTitle: '还没有书签',
        emptyBody: '在对话中选中文字，点击出现的「书签」，给这段内容起个标题即可收藏。',
        noMatchesTitle: '没有匹配的书签',
        noMatchesBody: '换个关键词试试。',
        ungrouped: '未归类',
        untitled: '未命名书签',
        unknownSession: '未知会话',
        bookmarkCountOne: '1 条书签',
        bookmarkCount: '{count} 条书签',
        projectCountOne: '1 个项目',
        projectCount: '{count} 个项目',
        addTitle: '添加书签',
        addAction: '书签',
        titleLabel: '标题',
        titlePlaceholder: '给这段内容起个标题',
        quoteLabel: '选中的内容',
        sourceLabel: '来源',
        selectionTruncated: '内容较长，仅保存前 20000 个字符。',
        save: '保存',
        saving: '保存中…',
        cancel: '取消',
        delete: '删除',
        deleteTitle: '删除书签',
        deleteBody: '删除「{title}」？此操作无法撤销。',
        editTitle: '编辑标题',
        viewText: '查看全文',
        openSession: '打开并高亮',
        sessionArchived: '该会话已归档，先恢复后才能打开。',
        sessionUnavailable: '找不到该会话，可能已被删除。',
        saved: '已添加书签',
        deleted: '已删除书签',
        saveFailed: '保存失败，请重试。',
        deleteFailed: '删除失败，请重试。',
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
        panelLabel: 'Bookmarks',
        panelTitle: 'Bookmarks',
        searchPlaceholder: 'Search title, text or session',
        searchLabel: 'Search bookmarks',
        clearSearch: 'Clear search',
        refresh: 'Refresh bookmarks',
        loading: 'Loading bookmarks…',
        loadFailed: 'Could not load bookmarks',
        retry: 'Retry',
        emptyTitle: 'No bookmarks yet',
        emptyBody: 'Select text in a conversation, then choose “Bookmark” to name and save it.',
        noMatchesTitle: 'No matching bookmarks',
        noMatchesBody: 'Try a different search.',
        ungrouped: 'Ungrouped',
        untitled: 'Untitled bookmark',
        unknownSession: 'Unknown session',
        bookmarkCountOne: '1 bookmark',
        bookmarkCount: '{count} bookmarks',
        projectCountOne: '1 project',
        projectCount: '{count} projects',
        addTitle: 'Add bookmark',
        addAction: 'Bookmark',
        titleLabel: 'Title',
        titlePlaceholder: 'Name this excerpt',
        quoteLabel: 'Selected text',
        sourceLabel: 'Source',
        selectionTruncated: 'The selection is long; only the first 20000 characters are saved.',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        delete: 'Delete',
        deleteTitle: 'Delete bookmark',
        deleteBody: 'Delete “{title}”? This cannot be undone.',
        editTitle: 'Edit title',
        viewText: 'View text',
        openSession: 'Open and highlight',
        sessionArchived: 'That conversation is archived. Restore it before opening.',
        sessionUnavailable: 'That conversation is no longer available.',
        saved: 'Bookmark added',
        deleted: 'Bookmark deleted',
        saveFailed: 'Could not save the bookmark. Try again.',
        deleteFailed: 'Could not delete the bookmark. Try again.',
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

    /** Bookmark panel, selection pill, editor, and feedback. */
    const BOOKMARK_CSS = `
.dsh-pf-bm-page{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}
.dsh-pf-bm-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.dsh-pf-bm-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dsh-pf-bm-heading{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px;padding-top:28px;display:flex}
[data-platform="darwin"] .dsh-pf-bm-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dsh-pf-bm-heading-text{min-width:0}
.dsh-pf-bm-heading h1{max-width:100%;min-width:0;flex:0 auto;margin:0;font-size:20px;font-weight:500;line-height:28px}
.dsh-pf-bm-count{color:var(--dsw-alias-label-tertiary);margin:2px 0 0;font-size:13px;line-height:20px}
.dsh-pf-bm-refresh{flex:none}
.dsh-pf-bm-notice{background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-secondary);border-radius:10px;margin:0 0 16px;padding:10px 12px;font-size:13px;line-height:20px}
.dsh-pf-bm-search{border:.5px solid var(--dsw-alias-border-l3);height:36px;color:var(--dsw-alias-label-tertiary);border-radius:12px;align-items:center;margin:0 0 18px;padding:0 10px;transition:border-color .15s;display:flex}
.dsh-pf-bm-search:hover{border-color:var(--dsw-alias-border-l2)}
.dsh-pf-bm-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.dsh-pf-bm-search>.dsh-pf-bm-search-input{background:0 0;border:0;border-radius:0;flex:1;min-width:0;height:100%;padding:0}
.dsh-pf-bm-search>.dsh-pf-bm-search-input:focus-within{border-color:#0000}
.dsh-pf-bm-search .dsh-pf-bm-search-input svg{width:14px;height:14px}
.dsh-pf-bm-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-pf-bm-search input:focus-visible{outline:none}
.dsh-pf-bm-search input::-webkit-search-cancel-button{display:none}
.dsh-pf-bm-search-clear{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);flex:none;margin-right:-6px;padding:0}
.dsh-pf-bm-search-clear svg{width:14px;height:14px}
.dsh-pf-bm-group{margin:0 0 26px}
.dsh-pf-bm-group-head{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;margin:0 0 6px;padding:0 8px;font-size:13px;line-height:20px;font-weight:500;display:flex}
.dsh-pf-bm-group-icon{color:var(--dsw-alias-label-tertiary);flex:none}
.dsh-pf-bm-group-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pf-bm-group-count{margin-left:auto;color:var(--dsw-alias-label-caption);font-weight:400;font-variant-numeric:tabular-nums}
.dsh-pf-bm-rows{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.dsh-pf-bm-row{border-radius:12px;align-items:flex-start;gap:8px;padding:8px;display:flex;position:relative}
.dsh-pf-bm-row:hover,.dsh-pf-bm-row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-pf-bm-open{text-align:left;color:inherit;font:inherit;cursor:pointer;background:0 0;border:0;flex:1;min-width:0;padding:0;flex-direction:column;gap:2px;display:flex}
.dsh-pf-bm-open:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:8px}
.dsh-pf-bm-title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:500;line-height:23px;display:block;overflow:hidden}
.dsh-pf-bm-quote{color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-width:0;font-size:13px;line-height:21px;display:-webkit-box;overflow:hidden}
.dsh-pf-bm-meta{color:var(--dsw-alias-label-caption);gap:6px;min-width:0;font-size:12px;line-height:18px;display:flex}
.dsh-pf-bm-meta-source{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dsh-pf-bm-meta-date{flex:none}
.dsh-pf-bm-meta-date:before{content:"·";padding-right:2px}
.dsh-pf-bm-actions{flex:none;align-items:center;gap:2px;display:flex;opacity:0;transition:opacity .1s}
.dsh-pf-bm-row:hover .dsh-pf-bm-actions,.dsh-pf-bm-row:focus-within .dsh-pf-bm-actions{opacity:1}
@media (hover:none){.dsh-pf-bm-actions{opacity:1}}
.dsh-pf-bm-iconbtn{width:28px;height:28px;border-radius:8px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;place-items:center;padding:0;display:grid}
.dsh-pf-bm-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-pf-bm-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsh-pf-bm-iconbtn-danger:hover{color:var(--dsw-alias-state-error-primary)}
.dsh-pf-bm-empty{text-align:center;color:var(--dsw-alias-label-tertiary);flex-direction:column;align-items:center;padding:56px 20px;font-size:14px;display:flex}
.dsh-pf-bm-empty-glyph{color:var(--dsw-alias-label-caption);margin-bottom:12px;display:flex}
.dsh-pf-bm-empty h2{color:var(--dsw-alias-label-tertiary);margin:0 0 8px;font-size:14px;font-weight:400;line-height:1.6}
.dsh-pf-bm-empty p{max-width:360px;margin:0 0 14px;color:var(--dsw-alias-label-caption);line-height:1.6}
.dsh-pf-bm-loading{text-align:center;color:var(--dsw-alias-label-tertiary);padding:56px 20px;font-size:14px}
.dsh-pf-bm-field{flex-direction:column;gap:6px;margin:0 0 16px;display:flex}
.dsh-pf-bm-field>label,.dsh-pf-bm-label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-pf-bm-input{width:100%}
.dsh-pf-bm-quote-block{max-height:180px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-specific-sidebar-fill);border-radius:10px;padding:10px 12px;font-size:13px;line-height:21px;overflow:auto}
.dsh-pf-bm-quote-full{max-height:min(50vh,360px)}
.dsh-pf-bm-hint{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dsh-pf-bm-source{color:var(--dsw-alias-label-tertiary);gap:8px;min-width:0;margin:0 0 4px;font-size:12px;line-height:18px;display:flex}
.dsh-pf-bm-source-label{color:var(--dsw-alias-label-caption);flex:none}
.dsh-pf-bm-source-value{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dsh-pf-bm-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.dsh-pf-bm-modal-actions{justify-content:flex-end;align-items:center;gap:8px;display:flex}
.dsh-pf-bm-modal-actions .dsh-pf-bm-danger-button{background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff}
.dsh-pf-bm-modal-actions .dsh-pf-bm-danger-button:hover{opacity:.9}
.dsh-pf-bm-pill{box-sizing:border-box;pointer-events:auto;position:fixed;z-index:40;height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:inherit;cursor:pointer;box-shadow:0 8px 24px rgb(0 0 0 / 12%),0 2px 6px rgb(0 0 0 / 6%);transition:background .12s ease}
.dsh-pf-bm-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-pf-bm-pill:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-pf-bm-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;box-shadow:0 10px 28px rgb(0 0 0 / 12%),0 2px 8px rgb(0 0 0 / 6%);pointer-events:none}
::highlight(dsh-pf-bookmark){background-color:rgba(0,145,255,.3);color:inherit}
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
     * Create one small external store for local UI state.
     *
     * @param initial - first snapshot.
     * @returns the store, with a synchronous setter.
     */
    function createSnapshotStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        set: (next) => {
          value = next;
          for (const listener of listeners) listener();
        },
      };
    }

    /**
     * Subscribe one component to a snapshot store.
     *
     * @param store - the snapshot store.
     * @returns the current snapshot.
     */
    function useStoreSnapshot(store) {
      const subscribe = useCallback((listener) => store.subscribe(listener), [store]);
      const snapshot = useCallback(() => store.getSnapshot(), [store]);
      return useSyncExternalStore(subscribe, snapshot, snapshot);
    }

    /**
     * The sidebar panel glyph: an outlined bookmark.
     *
     * @param props - the sidebar's icon share: size and selected state.
     * @returns an SVG element sized like the shipped panel icons.
     */
    function BookmarkGlyph({ size = 16, active = false }) {
      return React.createElement(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('path', {
          d: 'M4.5 2.25h7a.75.75 0 0 1 .75.75v10.25L8 10.7l-4.25 2.55V3a.75.75 0 0 1 .75-.75Z',
          fill: active === true ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: '1.35',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * Convert a DOM node from a selection into its element.
     *
     * @param node - boundary node of a range.
     * @returns the element, or null for an empty node.
     */
    function elementOf(node) {
      if (node === null || node === undefined) return null;
      return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    }

    /**
     * Read the last line box of a range, which is where the pill should sit.
     *
     * @param range - the selected range.
     * @returns a plain rectangle, or null when the range has no geometry.
     */
    function lastRectOf(range) {
      const rects = range.getClientRects();
      const rect = rects.length === 0 ? range.getBoundingClientRect() : rects[rects.length - 1];
      if (rect === undefined || (rect.width === 0 && rect.height === 0)) return null;
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }

    /**
     * Escape a string for use inside a regular expression.
     *
     * @param value - literal text.
     * @returns the escaped text.
     */
    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Drop every whitespace run, for anchor validation across block boundaries.
     *
     * @param value - source text.
     * @returns the text without whitespace.
     */
    function compactTextOf(value) {
      return value.replace(/\s+/g, '');
    }

    /**
     * Character length of one element's text content.
     *
     * @param root - element whose text nodes are counted.
     * @returns the character count.
     */
    function textLengthOf(root) {
      return root.textContent?.length ?? 0;
    }

    /**
     * Count the characters between an element's start and one range boundary.
     *
     * @param root - element that owns the text.
     * @param node - range boundary node.
     * @param offset - boundary offset.
     * @returns the character offset, or -1 when the boundary is outside root.
     */
    function offsetWithin(root, node, offset) {
      try {
        const range = document.createRange();
        range.selectNodeContents(root);
        const maximum = node.nodeType === Node.TEXT_NODE
          ? (node.nodeValue?.length ?? 0)
          : node.childNodes.length;
        range.setEnd(node, Math.max(0, Math.min(offset, maximum)));
        return range.toString().length;
      } catch {
        return -1;
      }
    }

    /**
     * Build a range between two character offsets inside one element.
     *
     * @param root - element that owns the text.
     * @param start - first character offset.
     * @param end - exclusive end offset.
     * @returns the range, or null when the span is empty or out of bounds.
     */
    function rangeWithin(root, start, end) {
      const length = textLengthOf(root);
      const from = Math.max(0, Math.min(start, length));
      const to = Math.max(from, Math.min(end, length));
      if (to <= from) return null;
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let offset = 0;
      let started = false;
      let current;
      while ((current = walker.nextNode()) !== null) {
        const value = current.nodeValue ?? '';
        const next = offset + value.length;
        if (started === false && from >= offset && from <= next) {
          range.setStart(current, Math.min(from - offset, value.length));
          started = true;
        }
        if (started && to >= offset && to <= next) {
          range.setEnd(current, Math.min(to - offset, value.length));
          return range.collapsed ? null : range;
        }
        offset = next;
      }
      return null;
    }

    /**
     * Flatten one conversation container's visible text, skipping the composer.
     *
     * @param root - transcript container.
     * @returns the concatenated text and its per-node offsets.
     */
    function collectTextSegments(root) {
      const segments = [];
      let full = '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (parent !== null && parent.closest('[data-conversation-region="composer"]') !== null) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let current;
      while ((current = walker.nextNode()) !== null) {
        const value = current.nodeValue ?? '';
        if (value === '') continue;
        segments.push({ node: current, start: full.length, end: full.length + value.length });
        full += value;
      }
      return { full, segments };
    }

    /**
     * Map character offsets in a flattened text back onto a DOM range.
     *
     * @param segments - text nodes with their global offsets.
     * @param from - first character offset.
     * @param to - exclusive end offset.
     * @returns the range, or null when the span cannot be represented.
     */
    function rangeFromSegments(segments, from, to) {
      if (from < 0 || to <= from) return null;
      const range = document.createRange();
      let startSet = false;
      let endSet = false;
      for (const segment of segments) {
        const valueLength = segment.node.nodeValue?.length ?? 0;
        if (startSet === false && from >= segment.start && from <= segment.end) {
          range.setStart(segment.node, Math.min(from - segment.start, valueLength));
          startSet = true;
        }
        if (startSet && endSet === false && to >= segment.start && to <= segment.end) {
          range.setEnd(segment.node, Math.min(to - segment.start, valueLength));
          endSet = true;
          break;
        }
      }
      return startSet && endSet && range.collapsed === false ? range : null;
    }

    /**
     * Find one saved excerpt in a rendered transcript.
     *
     * Exact text wins; a whitespace-tolerant pass then covers excerpts whose
     * block boundaries disappeared from the DOM's text-node stream.
     *
     * @param root - transcript container.
     * @param text - saved excerpt.
     * @returns the range, or null when the text is absent.
     */
    function findTextRange(root, text) {
      const needle = text.trim();
      if (needle === '') return null;
      const { full, segments } = collectTextSegments(root);
      if (full === '') return null;
      let index = full.indexOf(needle);
      let length = needle.length;
      if (index === -1) {
        const pattern = needle.split(/\s+/).map((part) => escapeRegExp(part)).join('\\s+');
        if (pattern !== '') {
          const match = new RegExp(pattern).exec(full);
          if (match !== null) {
            index = match.index;
            length = match[0].length;
          }
        }
      }
      if (index === -1) return null;
      return rangeFromSegments(segments, index, index + length);
    }

    /** CSS Custom Highlight registry name used for the located bookmark. */
    const BOOKMARK_HIGHLIGHT_NAME = 'dsh-pf-bookmark';
    /** How long a fresh navigation waits for the target message to render. */
    const BOOKMARK_HIGHLIGHT_TIMEOUT_MS = 12000;
    const BOOKMARK_HIGHLIGHT_RETRY_MS = 200;

    /**
     * Locate a bookmark in the rendered transcript, paint it with the CSS
     * Custom Highlight API, and bring it into view. The controller waits for a
     * session's history to render, but never mutates React-owned markup.
     *
     * @returns show/clear/dispose controls.
     */
    function createBookmarkHighlighter() {
      let observer = null;
      let attemptTimer = 0;
      let deadlineTimer = 0;
      let watchTimer = 0;
      let request = null;
      let retryScheduled = false;

      const supportsHighlights = () => typeof CSS !== 'undefined'
        && CSS !== null
        && CSS.highlights !== undefined
        && typeof Highlight === 'function';

      const clearRegistry = () => {
        if (supportsHighlights() === false) return;
        try {
          CSS.highlights.delete(BOOKMARK_HIGHLIGHT_NAME);
        } catch {
          // A document that lost its registry needs no cleanup.
        }
      };

      const stopWatching = () => {
        if (observer !== null) {
          observer.disconnect();
          observer = null;
        }
        if (attemptTimer !== 0) {
          window.clearTimeout(attemptTimer);
          attemptTimer = 0;
        }
        if (deadlineTimer !== 0) {
          window.clearTimeout(deadlineTimer);
          deadlineTimer = 0;
        }
        retryScheduled = false;
        request = null;
      };

      const stopWatch = () => {
        if (watchTimer !== 0) {
          window.clearInterval(watchTimer);
          watchTimer = 0;
        }
      };

      const startWatch = (sessionId) => {
        stopWatch();
        if (sessionId === '') return;
        // A live highlight follows the active conversation. A different
        // session id means the text nodes it points at are gone; drop both the
        // registry entry and the interval rather than leave a stale range.
        watchTimer = window.setInterval(() => {
          // Keep the highlight while its session is on screen, even if it is
          // the embedded copy. Only a visible *different* session means the
          // highlighted text nodes are gone for good.
          if (findConversation(sessionId) !== null) return;
          const other = findConversation('');
          const current = other === null ? '' : (other.getAttribute('data-conversation-session') ?? '');
          if (current !== '' && current !== sessionId) clear();
        }, 500);
      };

      const clear = () => {
        stopWatching();
        stopWatch();
        clearRegistry();
      };

      const isVisible = (element) => element.getClientRects().length > 0;

      const findConversation = (sessionId) => {
        const containers = [...document.querySelectorAll('[data-conversation-content]')];
        const candidates = sessionId === ''
          ? containers
          : containers.filter((container) => (
            container.getAttribute('data-conversation-session') ?? ''
          ) === sessionId);
        const visible = candidates.filter(isVisible);
        if (visible.length === 0) return null;
        // The main conversation is the widest matching surface; this keeps a
        // narrow embedded copy from winning the race while a panel closes.
        return visible.reduce((best, current) => (
          current.getBoundingClientRect().width > best.getBoundingClientRect().width ? current : best
        ));
      };

      const nodeByKey = (container, key) => {
        if (typeof key !== 'string' || key === '') return null;
        for (const element of container.querySelectorAll('[data-chat-node-key]')) {
          if (element.getAttribute('data-chat-node-key') === key) return element;
        }
        return null;
      };

      const rangesFor = (bookmark) => {
        const text = typeof bookmark.text === 'string' ? bookmark.text : '';
        if (text.trim() === '') return null;
        const container = findConversation(typeof bookmark.sessionId === 'string' ? bookmark.sessionId : '');
        if (container === null) return null;
        const startKey = typeof bookmark.anchorStartKey === 'string' ? bookmark.anchorStartKey : '';
        const endKey = typeof bookmark.anchorEndKey === 'string' ? bookmark.anchorEndKey : '';
        const startOffset = Number.isSafeInteger(bookmark.anchorStartOffset)
          ? Math.max(0, bookmark.anchorStartOffset)
          : null;
        const endOffset = Number.isSafeInteger(bookmark.anchorEndOffset)
          ? Math.max(0, bookmark.anchorEndOffset)
          : null;
        const startNode = nodeByKey(container, startKey);
        if (startNode !== null && startOffset !== null) {
          const ranges = [];
          if (endKey === '' || endKey === startKey) {
            if (endOffset !== null && endOffset > startOffset) {
              const range = rangeWithin(startNode, startOffset, endOffset);
              if (range !== null) ranges.push(range);
            }
          } else {
            const endNode = nodeByKey(container, endKey);
            if (endNode !== null && endOffset !== null) {
              const wrappers = [...container.querySelectorAll('[data-chat-node-key]')];
              const startIndex = wrappers.indexOf(startNode);
              const endIndex = wrappers.indexOf(endNode);
              if (startIndex !== -1 && endIndex > startIndex) {
                const first = rangeWithin(startNode, startOffset, textLengthOf(startNode));
                if (first !== null) ranges.push(first);
                for (let index = startIndex + 1; index < endIndex; index += 1) {
                  const middle = rangeWithin(wrappers[index], 0, textLengthOf(wrappers[index]));
                  if (middle !== null) ranges.push(middle);
                }
                const last = rangeWithin(endNode, 0, endOffset);
                if (last !== null) ranges.push(last);
              }
            }
          }
          if (ranges.length > 0) {
            const joined = ranges.map((range) => range.toString()).join('');
            if (compactTextOf(joined) === compactTextOf(text)) return ranges;
          }
        }

        // Old records (or records whose message markup changed) have no usable
        // anchors: search the transcript, preferring the saved turn and role.
        const wrappers = [...container.querySelectorAll('[data-chat-node-key]')];
        const preferred = wrappers.filter((node) => {
          if (Number.isSafeInteger(bookmark.turn) && node.getAttribute('data-chat-turn') !== String(bookmark.turn)) {
            return false;
          }
          if (typeof bookmark.role === 'string' && bookmark.role !== ''
            && node.getAttribute('data-chat-flow-kind') !== bookmark.role) {
            return false;
          }
          return true;
        });
        // Probe only the best few turn/role candidates; the one whole-container
        // search below covers everything else without rescanning every node on
        // each retry.
        for (const node of preferred.slice(0, 8)) {
          const range = findTextRange(node, text);
          if (range !== null) return [range];
        }
        const range = findTextRange(container, text);
        return range === null ? null : [range];
      };

      const applyRanges = (ranges, sessionId) => {
        const usable = ranges.filter((range) => range !== null && range.collapsed === false);
        if (usable.length === 0) return false;
        if (supportsHighlights()) {
          try {
            CSS.highlights.set(BOOKMARK_HIGHLIGHT_NAME, new Highlight(...usable));
          } catch (error) {
            console.warn('practical-frontend: applying the bookmark highlight failed', error);
          }
        } else {
          console.warn('practical-frontend: this browser cannot paint the bookmark highlight');
        }
        const start = usable[0].startContainer;
        const element = start.nodeType === Node.TEXT_NODE ? start.parentElement : start;
        if (element !== null && typeof element.scrollIntoView === 'function') {
          const reduced = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        }
        startWatch(sessionId);
        return true;
      };

      const locate = (bookmark) => {
        try {
          const ranges = rangesFor(bookmark);
          if (ranges === null) return false;
          return applyRanges(ranges, typeof bookmark.sessionId === 'string' ? bookmark.sessionId : '');
        } catch (error) {
          console.warn('practical-frontend: locating the bookmark failed', error);
          return false;
        }
      };

      const scheduleAttempt = () => {
        if (request === null || retryScheduled) return;
        retryScheduled = true;
        attemptTimer = window.setTimeout(() => {
          attemptTimer = 0;
          retryScheduled = false;
          if (request === null) return;
          if (locate(request.bookmark)) stopWatching();
        }, BOOKMARK_HIGHLIGHT_RETRY_MS);
      };

      const show = (bookmark) => {
        clear();
        if (typeof document === 'undefined' || bookmark === null || typeof bookmark !== 'object') return;
        if (typeof bookmark.text !== 'string' || bookmark.text.trim() === '') return;
        request = { bookmark };
        if (typeof MutationObserver !== 'function') {
          if (locate(bookmark)) stopWatching();
          return;
        }
        observer = new MutationObserver(scheduleAttempt);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        deadlineTimer = window.setTimeout(() => {
          stopWatching();
        }, BOOKMARK_HIGHLIGHT_TIMEOUT_MS);
        // Give the main panel a beat to replace the bookmark panel before the
        // first lookup; the observer covers everything after that.
        scheduleAttempt();
      };

      return { show, clear, dispose: clear };
    }

    /**
     * Read the directory name from a workspace path.
     *
     * @param path - absolute path.
     * @returns the last segment, or an empty string.
     */
    function baseNameOf(path) {
      if (typeof path !== 'string') return '';
      const parts = path.split(/[\\/]+/).filter((part) => part !== '');
      return parts.length === 0 ? '' : parts[parts.length - 1];
    }

    /**
     * Cap a string by user-perceived characters.
     *
     * @param value - source text.
     * @param maximum - maximum characters.
     * @returns the longest allowed prefix.
     */
    function clipCharacters(value, maximum) {
      return Array.from(value).slice(0, maximum).join('');
    }

    /**
     * Derive a default bookmark title from its text.
     *
     * @param text - selected text.
     * @param fallback - used when the selection has no visible characters.
     * @returns a one-line title.
     */
    function defaultTitleOf(text, fallback) {
      const line = text
        .split(/\r?\n/)
        .map((part) => part.trim())
        .find((part) => part !== '') ?? '';
      if (line === '') return fallback;
      const clipped = clipCharacters(line, 48);
      return Array.from(line).length > 48 ? `${clipped}…` : clipped;
    }

    /**
     * A bookmark's display title, falling back to its excerpt.
     *
     * @param bookmark - the stored record.
     * @param fallback - label when both title and text are empty.
     * @returns the display title.
     */
    function titleOf(bookmark, fallback) {
      if (typeof bookmark.title === 'string' && bookmark.title.trim() !== '') return bookmark.title;
      return defaultTitleOf(typeof bookmark.text === 'string' ? bookmark.text : '', fallback);
    }

    /**
     * Collapse an excerpt for the list's two-line preview.
     *
     * @param text - selected text.
     * @returns a compact excerpt.
     */
    function excerptOf(text) {
      return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    /**
     * Find the workspace that owns one session.
     *
     * @param workspaceSnapshot - Workspace projection.
     * @param sessionId - session identity, possibly empty.
     * @param sessionRow - Session list row, when listed.
     * @returns the Workspace view, or undefined.
     */
    function workspaceOfSession(workspaceSnapshot, sessionId, sessionRow) {
      const items = Array.isArray(workspaceSnapshot?.items) ? workspaceSnapshot.items : [];
      if (sessionId !== '') {
        const direct = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId));
        if (direct !== undefined) return direct;
      }
      const cwd = sessionRow?.cwd;
      if (typeof cwd === 'string' && cwd !== '') {
        const byPath = items.find((item) => item.path === cwd);
        if (byPath !== undefined) return byPath;
      }
      return undefined;
    }

    /**
     * Capture the current conversation selection into a bookmark draft.
     *
     * @param sessions - Session list snapshot store.
     * @param workspaces - Workspace list snapshot store.
     * @returns the draft, or null when the selection is not a conversation excerpt.
     */
    function captureSelection(sessions, workspaces) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return null;
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const startElement = elementOf(range.startContainer);
      const endElement = elementOf(range.endContainer);
      if (startElement === null || endElement === null) return null;
      const container = startElement.closest('[data-conversation-content]');
      if (container === null || container.contains(endElement) === false) return null;
      if (startElement.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') !== null) return null;
      if (endElement.closest('input, textarea, [contenteditable="true"], [contenteditable=""]') !== null) return null;
      const raw = selection.toString().replaceAll('\u0000', '').trim();
      if (raw === '') return null;
      const rect = lastRectOf(range);
      if (rect === null) return null;
      const text = clipCharacters(raw, MAX_TEXT);
      const sessionId = container.getAttribute('data-conversation-session') ?? '';
      const sessionSnapshot = typeof sessions?.getSnapshot === 'function' ? sessions.getSnapshot() : undefined;
      const sessionRow = sessionId !== '' ? sessionSnapshot?.byId?.[sessionId] : undefined;
      const workspaceSnapshot = typeof workspaces?.getSnapshot === 'function' ? workspaces.getSnapshot() : undefined;
      const workspace = workspaceOfSession(workspaceSnapshot, sessionId, sessionRow);
      const flow = startElement.closest('[data-chat-flow-kind]');
      const turn = startElement.closest('[data-chat-turn]');
      const parsedTurn = turn === null ? Number.NaN : Number.parseInt(turn.getAttribute('data-chat-turn') ?? '', 10);
      const startAnchor = startElement.closest('[data-chat-node-key]');
      const endAnchor = endElement.closest('[data-chat-node-key]');
      const startOffset = startAnchor === null
        ? -1
        : offsetWithin(startAnchor, range.startContainer, range.startOffset);
      const endOffset = endAnchor === null
        ? -1
        : offsetWithin(endAnchor, range.endContainer, range.endOffset);
      return {
        text,
        truncated: Array.from(raw).length > MAX_TEXT,
        sessionId,
        sessionTitle: sessionRow?.displayTitle ?? sessionRow?.title ?? '',
        workspaceId: workspace?.workspaceId ?? '',
        workspaceTitle: workspace?.title ?? baseNameOf(workspace?.path),
        workspacePath: workspace?.path ?? '',
        role: flow === null ? '' : (flow.getAttribute('data-chat-flow-kind') ?? '').slice(0, 32),
        turn: Number.isSafeInteger(parsedTurn) && parsedTurn >= 0 ? parsedTurn : null,
        anchorStartKey: startAnchor?.getAttribute('data-chat-node-key') ?? '',
        anchorStartOffset: startOffset >= 0 ? startOffset : null,
        anchorEndKey: endAnchor?.getAttribute('data-chat-node-key') ?? '',
        anchorEndOffset: endOffset >= 0 ? endOffset : null,
        rect,
      };
    }

    /**
     * Build the payload the Host stores from a captured draft.
     *
     * @param draft - captured selection.
     * @param title - user-supplied title.
     * @returns the bookmark fields, without the transient rectangle.
     */
    function bookmarkPayloadOf(draft, title) {
      return {
        title,
        text: draft.text,
        sessionId: draft.sessionId,
        sessionTitle: draft.sessionTitle,
        workspaceId: draft.workspaceId,
        workspaceTitle: draft.workspaceTitle,
        workspacePath: draft.workspacePath,
        role: draft.role,
        turn: draft.turn,
        anchorStartKey: draft.anchorStartKey,
        anchorStartOffset: draft.anchorStartOffset,
        anchorEndKey: draft.anchorEndKey,
        anchorEndOffset: draft.anchorEndOffset,
      };
    }

    /** Formatter cache keyed by locale and options. */
    const DATE_FORMATTERS = new Map();

    /**
     * Resolve one reusable date formatter.
     *
     * @param locale - BCP-47 locale.
     * @param options - Intl.DateTimeFormat options.
     * @returns the cached formatter.
     */
    function dateFormatterFor(locale, options) {
      const key = `${locale}|${JSON.stringify(options)}`;
      let formatter = DATE_FORMATTERS.get(key);
      if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(locale, options);
        DATE_FORMATTERS.set(key, formatter);
      }
      return formatter;
    }

    /**
     * Format a bookmark timestamp for the active language.
     *
     * @param timestamp - milliseconds since the epoch.
     * @param locale - BCP-47 locale.
     * @returns a short date or time.
     */
    function formatBookmarkDate(timestamp, locale) {
      if (Number.isFinite(timestamp) === false || timestamp <= 0) return '';
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      const now = new Date();
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();
      try {
        if (sameDay) return dateFormatterFor(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
        if (date.getFullYear() === now.getFullYear()) {
          return dateFormatterFor(locale, { month: 'short', day: 'numeric' }).format(date);
        }
        return dateFormatterFor(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
      } catch {
        return date.toLocaleDateString();
      }
    }

    /**
     * One dictionary-free locale hint for date formatting.
     *
     * @returns a BCP-47 locale.
     */
    function dateLocale() {
      const language = typeof navigator !== 'undefined' && typeof navigator.language === 'string'
        ? navigator.language
        : 'zh-CN';
      return language.toLowerCase().startsWith('zh') ? 'zh-CN' : language;
    }

    /**
     * Whether one bookmark matches a lower-case search needle.
     *
     * @param bookmark - stored record.
     * @param needle - lower-case query.
     * @param sessionSnapshot - Session projection.
     * @param workspaceSnapshot - Workspace projection.
     * @returns true when any visible field contains the query.
     */
    function bookmarkMatches(bookmark, needle, sessionSnapshot, workspaceSnapshot) {
      if (needle === '') return true;
      if (typeof bookmark.searchText === 'string' && bookmark.searchText.includes(needle)) return true;
      const sessionRow = sessionSnapshot?.byId?.[bookmark.sessionId];
      const workspace = workspaceOfSession(workspaceSnapshot, bookmark.sessionId, sessionRow);
      const fields = [sessionRow?.displayTitle, workspace?.title, workspace?.path];
      return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(needle));
    }

    /**
     * Group bookmarks by the Workspace that owns their session, newest first.
     *
     * @param bookmarks - already filtered bookmarks, newest first.
     * @param sessionSnapshot - Session projection.
     * @param workspaceSnapshot - Workspace projection.
     * @param ungroupedLabel - label for records without a Workspace.
     * @returns groups in first-appearance order.
     */
    function groupBookmarks(bookmarks, sessionSnapshot, workspaceSnapshot, ungroupedLabel) {
      const groups = new Map();
      for (const bookmark of bookmarks) {
        const sessionRow = sessionSnapshot?.byId?.[bookmark.sessionId];
        const live = workspaceOfSession(workspaceSnapshot, bookmark.sessionId, sessionRow);
        const workspaceId = live?.workspaceId ?? bookmark.workspaceId ?? '';
        const title = live !== undefined
          ? (live.title || baseNameOf(live.path))
          : (bookmark.workspaceTitle || baseNameOf(bookmark.workspacePath));
        const key = workspaceId === '' ? '\u0000ungrouped' : `workspace:${workspaceId}`;
        let group = groups.get(key);
        if (group === undefined) {
          group = { key, title: title || ungroupedLabel, bookmarks: [] };
          groups.set(key, group);
        } else if ((group.title === ungroupedLabel || group.title === '') && title !== '') {
          group.title = title;
        }
        group.bookmarks.push(bookmark);
      }
      return Array.from(groups.values());
    }

    /**
     * Normalize one bookmark received from the Host and precompute its search
     * haystack, so typing in the panel never re-lowercases every excerpt.
     *
     * @param entry - one Host bookmark.
     * @returns the client-side record.
     */
    function normalizeClientBookmark(entry) {
      const text = typeof entry.text === 'string' ? entry.text : '';
      const title = typeof entry.title === 'string' ? entry.title : '';
      const sessionTitle = typeof entry.sessionTitle === 'string' ? entry.sessionTitle : '';
      const workspaceTitle = typeof entry.workspaceTitle === 'string' ? entry.workspaceTitle : '';
      const workspacePath = typeof entry.workspacePath === 'string' ? entry.workspacePath : '';
      return {
        ...entry,
        text,
        title,
        sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : '',
        sessionTitle,
        workspaceId: typeof entry.workspaceId === 'string' ? entry.workspaceId : '',
        workspaceTitle,
        workspacePath,
        role: typeof entry.role === 'string' ? entry.role : '',
        turn: Number.isSafeInteger(entry.turn) ? entry.turn : null,
        anchorStartKey: typeof entry.anchorStartKey === 'string' ? entry.anchorStartKey : '',
        anchorStartOffset: Number.isSafeInteger(entry.anchorStartOffset) ? entry.anchorStartOffset : null,
        anchorEndKey: typeof entry.anchorEndKey === 'string' ? entry.anchorEndKey : '',
        anchorEndOffset: Number.isSafeInteger(entry.anchorEndOffset) ? entry.anchorEndOffset : null,
        createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
        searchText: [title, text, sessionTitle, workspaceTitle, workspacePath].join('\n').toLowerCase(),
      };
    }

    /**
     * Read one bookmark list from a Host response.
     *
     * @param response - fetch response.
     * @returns the normalized list.
     */
    async function readBookmarkList(response) {
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('application/json') === false) throw new Error('unexpected bookmark response');
      const body = await response.json();
      if (body === null || typeof body !== 'object' || Array.isArray(body.bookmarks) === false) {
        throw new Error('malformed bookmark response');
      }
      return body.bookmarks
        .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
        .map((entry) => normalizeClientBookmark(entry));
    }

    /**
     * Render one title field, shared by the editor and the rename dialog.
     *
     * @param props - field props.
     * @returns the labelled input.
     */
    function TitleField({ t, id, value, onChange }) {
      return React.createElement(
        'div',
        { className: 'dsh-pf-bm-field' },
        React.createElement('label', { htmlFor: id }, t('titleLabel')),
        React.createElement(Input, {
          id,
          className: 'dsh-pf-bm-input',
          value,
          maxLength: MAX_TITLE,
          placeholder: t('titlePlaceholder'),
          autoFocus: true,
          onChange: (event) => onChange(event.target.value),
        }),
      );
    }

    /**
     * The editor that turns one selected excerpt into a bookmark.
     *
     * @param props - draft, title, save state, and callbacks.
     * @returns the modal.
     */
    function BookmarkEditorDialog({ t, draft, title, saving, error, onTitleChange, onSave, onClose }) {
      const close = () => {
        if (saving === false) onClose();
      };
      const source = [];
      if (draft.sessionTitle !== '') source.push(draft.sessionTitle);
      else if (draft.sessionId !== '') source.push(draft.sessionId.slice(0, 8));
      if (draft.workspaceTitle !== '') source.push(draft.workspaceTitle);
      return React.createElement(
        Modal,
        {
          open: true,
          onClose: close,
          title: t('addTitle'),
          closeLabel: t('cancel'),
          footer: React.createElement(
            'div',
            { className: 'dsh-pf-bm-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: close, disabled: saving }, t('cancel')),
            React.createElement(
              Button,
              {
                variant: 'primary',
                onClick: onSave,
                disabled: saving || title.trim() === '',
              },
              saving ? t('saving') : t('save'),
            ),
          ),
        },
        React.createElement(
          'div',
          { className: 'dsh-pf-bm-editor' },
          React.createElement(TitleField, { t, id: 'dsh-pf-bm-title', value: title, onChange: onTitleChange }),
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-field' },
            React.createElement('span', { className: 'dsh-pf-bm-label' }, t('quoteLabel')),
            React.createElement('div', { className: 'dsh-pf-bm-quote-block', tabIndex: 0 }, draft.text),
            draft.truncated === true
              ? React.createElement('span', { className: 'dsh-pf-bm-hint' }, t('selectionTruncated'))
              : null,
          ),
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-source' },
            React.createElement('span', { className: 'dsh-pf-bm-source-label' }, t('sourceLabel')),
            React.createElement(
              'span',
              { className: 'dsh-pf-bm-source-value' },
              source.length === 0 ? t('unknownSession') : source.join(' · '),
            ),
          ),
          error === ''
            ? null
            : React.createElement('p', { className: 'dsh-pf-bm-error', role: 'alert' }, error),
        ),
      );
    }

    /**
     * The rename dialog reused by the panel.
     *
     * @param props - bookmark, title, save state, and callbacks.
     * @returns the modal.
     */
    function BookmarkRenameDialog({ t, bookmark, title, saving, error, onTitleChange, onSave, onClose }) {
      const close = () => {
        if (saving === false) onClose();
      };
      return React.createElement(
        Modal,
        {
          open: true,
          onClose: close,
          title: t('editTitle'),
          closeLabel: t('cancel'),
          footer: React.createElement(
            'div',
            { className: 'dsh-pf-bm-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: close, disabled: saving }, t('cancel')),
            React.createElement(
              Button,
              {
                variant: 'primary',
                onClick: onSave,
                disabled: saving || title.trim() === '',
              },
              saving ? t('saving') : t('save'),
            ),
          ),
        },
        React.createElement(
          'div',
          { className: 'dsh-pf-bm-editor' },
          React.createElement(TitleField, { t, id: 'dsh-pf-bm-rename', value: title, onChange: onTitleChange }),
          React.createElement('div', { className: 'dsh-pf-bm-quote-block' }, excerptOf(bookmark.text).slice(0, 400)),
          error === ''
            ? null
            : React.createElement('p', { className: 'dsh-pf-bm-error', role: 'alert' }, error),
        ),
      );
    }

    /**
     * The destructive confirmation shown before a bookmark is removed.
     *
     * @param props - bookmark, progress, and callbacks.
     * @returns the modal.
     */
    function BookmarkDeleteDialog({ t, bookmark, deleting, error, onConfirm, onClose }) {
      return React.createElement(
        Modal,
        {
          open: true,
          onClose: deleting === true ? () => {} : onClose,
          title: t('deleteTitle'),
          description: t('deleteBody', { title: titleOf(bookmark, t('untitled')) }),
          closeLabel: t('cancel'),
          footer: React.createElement(
            'div',
            { className: 'dsh-pf-bm-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: onClose, disabled: deleting }, t('cancel')),
            React.createElement(
              Button,
              {
                variant: 'primary',
                className: 'dsh-pf-bm-danger-button',
                onClick: onConfirm,
                disabled: deleting,
              },
              deleting ? t('saving') : t('delete'),
            ),
          ),
        },
        error === '' ? null : React.createElement('p', { className: 'dsh-pf-bm-error', role: 'alert' }, error),
      );
    }

    /**
     * The read-only view of one saved excerpt.
     *
     * @param props - bookmark and callbacks.
     * @returns the modal.
     */
    function BookmarkDetailDialog({ t, bookmark, onOpen, onClose }) {
      const source = [];
      if (bookmark.sessionTitle !== '') source.push(bookmark.sessionTitle);
      else if (bookmark.sessionId !== '') source.push(bookmark.sessionId.slice(0, 8));
      if (bookmark.workspaceTitle !== '') source.push(bookmark.workspaceTitle);
      return React.createElement(
        Modal,
        {
          open: true,
          onClose,
          title: titleOf(bookmark, t('untitled')),
          closeLabel: t('cancel'),
          footer: React.createElement(
            'div',
            { className: 'dsh-pf-bm-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: onClose }, t('cancel')),
            React.createElement(Button, { variant: 'primary', onClick: onOpen }, t('openSession')),
          ),
        },
        React.createElement(
          'div',
          { className: 'dsh-pf-bm-editor' },
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-source' },
            React.createElement('span', { className: 'dsh-pf-bm-source-label' }, t('sourceLabel')),
            React.createElement(
              'span',
              { className: 'dsh-pf-bm-source-value' },
              source.length === 0 ? t('unknownSession') : source.join(' · '),
            ),
          ),
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-quote-block dsh-pf-bm-quote-full', tabIndex: 0 },
            bookmark.text,
          ),
        ),
      );
    }

    /**
     * The 书签 panel: searchable bookmarks grouped by project.
     *
     * @param props - stores, localized copy, and Host callbacks.
     * @returns the main panel.
     */
    function BookmarksPanel(props) {
      const { t, bookmarks, sessions, workspaces, openBookmark, onRefresh, onSave, onDelete } = props;
      const bookmarkState = useStoreSnapshot(bookmarks);
      const sessionState = useStoreSnapshot(sessions);
      const workspaceState = useStoreSnapshot(workspaces);
      const [query, setQuery] = useState('');
      const [notice, setNotice] = useState('');
      const [editing, setEditing] = useState(null);
      const [deleting, setDeleting] = useState(null);
      const [viewing, setViewing] = useState(null);
      const noticeTimer = useRef(0);

      useEffect(() => () => {
        window.clearTimeout(noticeTimer.current);
      }, []);

      // The Host list can move while the panel is away (another window or a
      // bookmark saved from the conversation). Read once whenever the panel
      // mounts; the heading's refresh control covers the rest.
      useEffect(() => {
        onRefresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only read
      }, []);

      const showNotice = (message) => {
        setNotice(message);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(''), 4000);
      };

      const items = bookmarkState.items;
      const needle = query.trim().toLowerCase();
      const filtered = useMemo(
        () => (needle === ''
          ? items
          : items.filter((bookmark) => bookmarkMatches(bookmark, needle, sessionState, workspaceState))),
        [items, needle, sessionState, workspaceState],
      );
      const groups = useMemo(
        () => groupBookmarks(filtered, sessionState, workspaceState, t('ungrouped')),
        [filtered, sessionState, workspaceState, t],
      );
      const allGroups = useMemo(
        () => groupBookmarks(items, sessionState, workspaceState, t('ungrouped')),
        [items, sessionState, workspaceState, t],
      );

      const open = (bookmark) => {
        if (bookmark.sessionId === '') {
          showNotice(t('sessionUnavailable'));
          return;
        }
        const archived = Array.isArray(workspaceState.archivedSessionIds)
          && workspaceState.archivedSessionIds.includes(bookmark.sessionId);
        if (archived) {
          showNotice(t('sessionArchived'));
          return;
        }
        try {
          openBookmark(bookmark);
        } catch (error) {
          console.error('practical-frontend: opening the bookmarked session failed', error);
          showNotice(t('sessionUnavailable'));
        }
      };

      const beginRename = (bookmark) => {
        setEditing({ bookmark, title: titleOf(bookmark, t('untitled')), saving: false, error: '' });
      };

      const saveRename = async () => {
        if (editing === null || editing.title.trim() === '') return;
        setEditing({ ...editing, saving: true, error: '' });
        try {
          await onSave({ ...editing.bookmark, title: editing.title.trim() });
          setEditing(null);
        } catch (error) {
          console.error('practical-frontend: renaming the bookmark failed', error);
          setEditing((current) => (current === null ? null : { ...current, saving: false, error: t('saveFailed') }));
        }
      };

      const confirmDelete = async () => {
        if (deleting === null) return;
        setDeleting({ ...deleting, deleting: true, error: '' });
        try {
          await onDelete(deleting.bookmark.id);
          setDeleting(null);
          showNotice(t('deleted'));
        } catch (error) {
          console.error('practical-frontend: deleting the bookmark failed', error);
          setDeleting((current) => (current === null ? null : { ...current, deleting: false, error: t('deleteFailed') }));
        }
      };

      const renderRow = (bookmark) => {
        const title = titleOf(bookmark, t('untitled'));
        const sessionRow = sessionState.byId?.[bookmark.sessionId];
        const sessionTitle = sessionRow?.displayTitle ?? bookmark.sessionTitle;
        const date = formatBookmarkDate(bookmark.createdAt, dateLocale());
        return React.createElement(
          'li',
          { key: bookmark.id, className: 'dsh-pf-bm-row' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-pf-bm-open',
              title: t('openSession'),
              onClick: () => open(bookmark),
            },
            React.createElement('span', { className: 'dsh-pf-bm-title' }, title),
            bookmark.text.trim() === ''
              ? null
              : React.createElement('span', { className: 'dsh-pf-bm-quote' }, excerptOf(bookmark.text)),
            React.createElement(
              'span',
              { className: 'dsh-pf-bm-meta' },
              React.createElement(
                'span',
                { className: 'dsh-pf-bm-meta-source' },
                sessionTitle === '' ? t('unknownSession') : sessionTitle,
              ),
              date === '' ? null : React.createElement('span', { className: 'dsh-pf-bm-meta-date' }, date),
            ),
          ),
          React.createElement(
            'span',
            { className: 'dsh-pf-bm-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-pf-bm-iconbtn',
                title: t('viewText'),
                'aria-label': `${t('viewText')}: ${title}`,
                onClick: () => setViewing(bookmark),
              },
              React.createElement(IconInspectOutlineRegular, { size: 14 }),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-pf-bm-iconbtn',
                title: t('editTitle'),
                'aria-label': `${t('editTitle')}: ${title}`,
                onClick: () => beginRename(bookmark),
              },
              React.createElement(IconEditOutlineRegular, { size: 14 }),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-pf-bm-iconbtn dsh-pf-bm-iconbtn-danger',
                title: t('delete'),
                'aria-label': `${t('delete')}: ${title}`,
                onClick: () => setDeleting({ bookmark, deleting: false, error: '' }),
              },
              React.createElement(IconTrashOutlineRegular, { size: 14 }),
            ),
          ),
        );
      };

      const renderBody = () => {
        if (items.length === 0 && bookmarkState.status === 'loading') {
          return React.createElement('div', { className: 'dsh-pf-bm-loading', role: 'status' }, t('loading'));
        }
        if (items.length === 0 && bookmarkState.status === 'error') {
          return React.createElement(
            'div',
            { className: 'dsh-pf-bm-empty', role: 'status' },
            React.createElement(IconWarningTriangleOutlineRegular, { size: 24, className: 'dsh-pf-bm-empty-glyph' }),
            React.createElement('h2', null, t('loadFailed')),
            React.createElement(Button, { variant: 'outline', onClick: onRefresh }, t('retry')),
          );
        }
        if (items.length === 0) {
          return React.createElement(
            'div',
            { className: 'dsh-pf-bm-empty', role: 'status' },
            React.createElement(BookmarkGlyph, { size: 28 }),
            React.createElement('h2', null, t('emptyTitle')),
            React.createElement('p', null, t('emptyBody')),
          );
        }
        if (filtered.length === 0) {
          return React.createElement(
            'div',
            { className: 'dsh-pf-bm-empty', role: 'status' },
            React.createElement(IconSearchOutlineRegular, { size: 24, className: 'dsh-pf-bm-empty-glyph' }),
            React.createElement('h2', null, t('noMatchesTitle')),
            React.createElement('p', null, t('noMatchesBody')),
          );
        }
        return groups.map((group) => React.createElement(
          'section',
          { key: group.key, className: 'dsh-pf-bm-group', 'aria-label': group.title },
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-group-head' },
            React.createElement(IconFolderOpenOutlineRegular, { size: 14, className: 'dsh-pf-bm-group-icon' }),
            React.createElement('span', { className: 'dsh-pf-bm-group-title' }, group.title),
            React.createElement('span', { className: 'dsh-pf-bm-group-count' }, String(group.bookmarks.length)),
          ),
          React.createElement('ul', { className: 'dsh-pf-bm-rows' }, group.bookmarks.map(renderRow)),
        ));
      };

      const bookmarkCount = items.length === 1
        ? t('bookmarkCountOne')
        : t('bookmarkCount', { count: items.length });
      const projectCount = allGroups.length === 1
        ? t('projectCountOne')
        : t('projectCount', { count: allGroups.length });

      return React.createElement(
        'section',
        { className: 'dsh-pf-bm-page', 'aria-label': t('panelTitle') },
        React.createElement(
          'div',
          { className: 'dsh-pf-bm-scroll' },
          React.createElement(
            'div',
            { className: 'dsh-pf-bm-content' },
            React.createElement(
              'div',
              { className: 'dsh-pf-bm-heading' },
              React.createElement(
                'div',
                { className: 'dsh-pf-bm-heading-text' },
                React.createElement('h1', null, t('panelTitle')),
                React.createElement('p', { className: 'dsh-pf-bm-count' }, `${bookmarkCount} · ${projectCount}`),
              ),
              React.createElement(Button, {
                variant: 'ghost',
                size: 'sm',
                className: 'dsh-pf-bm-refresh',
                icon: React.createElement(IconRefreshOutlineRegular, { size: 14 }),
                title: t('refresh'),
                'aria-label': t('refresh'),
                disabled: bookmarkState.status === 'loading',
                onClick: onRefresh,
              }),
            ),
            notice === ''
              ? null
              : React.createElement('div', { className: 'dsh-pf-bm-notice', role: 'status' }, notice),
            React.createElement(
              'div',
              { className: 'dsh-pf-bm-search' },
              React.createElement(Input, {
                type: 'search',
                className: 'dsh-pf-bm-search-input',
                value: query,
                icon: React.createElement(IconSearchOutlineRegular, {}),
                placeholder: t('searchPlaceholder'),
                'aria-label': t('searchLabel'),
                onChange: (event) => setQuery(event.target.value),
              }),
              query === ''
                ? null
                : React.createElement(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  className: 'dsh-pf-bm-search-clear',
                  icon: React.createElement(IconCloseOutlineRegular, {}),
                  title: t('clearSearch'),
                  'aria-label': t('clearSearch'),
                  onClick: () => setQuery(''),
                }),
            ),
            renderBody(),
          ),
        ),
        editing === null
          ? null
          : React.createElement(BookmarkRenameDialog, {
            t,
            bookmark: editing.bookmark,
            title: editing.title,
            saving: editing.saving,
            error: editing.error,
            onTitleChange: (value) => setEditing((current) => (current === null ? null : { ...current, title: value })),
            onSave: saveRename,
            onClose: () => setEditing(null),
          }),
        deleting === null
          ? null
          : React.createElement(BookmarkDeleteDialog, {
            t,
            bookmark: deleting.bookmark,
            deleting: deleting.deleting,
            error: deleting.error,
            onConfirm: confirmDelete,
            onClose: () => setDeleting(null),
          }),
        viewing === null
          ? null
          : React.createElement(BookmarkDetailDialog, {
            t,
            bookmark: viewing,
            onOpen: () => {
              open(viewing);
              setViewing(null);
            },
            onClose: () => setViewing(null),
          }),
      );
    }

    /**
     * The selection pill, editor, and confirmation toast.
     *
     * @param props - snapshot stores, localized copy, and the Host save call.
     * @returns the overlay subtree.
     */
    function BookmarkOverlay(props) {
      const { t, sessions, workspaces, onSave } = props;
      const [selection, setSelection] = useState(null);
      const [editor, setEditor] = useState(null);
      const [toast, setToast] = useState('');
      const selectionRef = useRef(null);
      const editorRef = useRef(null);
      const toastTimer = useRef(0);

      editorRef.current = editor;

      useEffect(() => () => {
        window.clearTimeout(toastTimer.current);
      }, []);

      const capture = useCallback(() => captureSelection(sessions, workspaces), [sessions, workspaces]);

      const showToast = (message) => {
        setToast(message);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(''), 2400);
      };

      useEffect(() => {
        let frame = 0;
        const hide = () => {
          selectionRef.current = null;
          setSelection(null);
        };
        const sync = () => {
          if (editorRef.current !== null) return;
          const next = capture();
          selectionRef.current = next;
          setSelection(next);
        };
        const schedule = () => {
          if (frame !== 0) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            frame = 0;
            sync();
          });
        };
        const onPointerDown = (event) => {
          if (event.target instanceof Element && event.target.closest(`[${BOOKMARK_PILL_ATTRIBUTE}]`) !== null) return;
          hide();
        };
        const onPointerUp = (event) => {
          if (event.target instanceof Element && event.target.closest(`[${BOOKMARK_PILL_ATTRIBUTE}]`) !== null) return;
          schedule();
        };
        const onSelectionChange = () => {
          const current = window.getSelection();
          if (current === null || current.isCollapsed) hide();
        };
        const onKeyUp = (event) => {
          if (event.key === 'Escape') {
            hide();
            return;
          }
          if (event.shiftKey === true || event.key === 'Shift') schedule();
        };
        const onScroll = () => hide();
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('selectionchange', onSelectionChange);
        document.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('pointerup', onPointerUp, true);
          document.removeEventListener('selectionchange', onSelectionChange);
          document.removeEventListener('keyup', onKeyUp, true);
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
        };
      }, [capture]);

      const openEditor = () => {
        const fresh = capture();
        const draft = fresh ?? selectionRef.current;
        if (draft === null) return;
        selectionRef.current = null;
        setSelection(null);
        setEditor({
          draft,
          title: defaultTitleOf(draft.text, t('untitled')),
          saving: false,
          error: '',
        });
        try {
          window.getSelection()?.removeAllRanges();
        } catch {
          // A selection owned by another surface is already gone.
        }
      };

      const saveEditor = async () => {
        if (editor === null || editor.saving || editor.title.trim() === '') return;
        setEditor({ ...editor, saving: true, error: '' });
        try {
          await onSave(bookmarkPayloadOf(editor.draft, editor.title.trim()));
          setEditor(null);
          showToast(t('saved'));
        } catch (error) {
          console.error('practical-frontend: saving the bookmark failed', error);
          setEditor((current) => (current === null ? null : { ...current, saving: false, error: t('saveFailed') }));
        }
      };

      let pill = null;
      if (selection !== null) {
        const width = 92;
        const height = 32;
        const rect = selection.rect;
        const maxLeft = Math.max(8, window.innerWidth - width - 8);
        const left = Math.min(Math.max(8, rect.right - width), maxLeft);
        let top = rect.bottom + 8;
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
        pill = React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-pf-bm-pill',
            style: { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` },
            [BOOKMARK_PILL_ATTRIBUTE]: '',
            onPointerDown: (event) => {
              // A pointerdown default would collapse the selection on mouse
              // before the click opens the editor. Touch keeps its default so
              // the tap still becomes a click; the captured draft is retained.
              if (event.pointerType !== 'touch') event.preventDefault();
            },
            onClick: openEditor,
          },
          React.createElement(BookmarkGlyph, { size: 13 }),
          React.createElement('span', null, t('addAction')),
        );
      }

      return React.createElement(
        React.Fragment,
        null,
        pill,
        editor === null
          ? null
          : React.createElement(BookmarkEditorDialog, {
            t,
            draft: editor.draft,
            title: editor.title,
            saving: editor.saving,
            error: editor.error,
            onTitleChange: (value) => setEditor((current) => (current === null ? null : { ...current, title: value })),
            onSave: saveEditor,
            onClose: () => setEditor(null),
          }),
        toast === ''
          ? null
          : React.createElement(
            'div',
            { className: 'dsh-pf-bm-toast', role: 'status' },
            React.createElement(BookmarkGlyph, { size: 14 }),
            React.createElement('span', null, toast),
          ),
      );
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
      inject: ['slots', 'sessions', 'workspaces', 'uiWorkspace'],
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
         * @param params - optional `{name}` interpolation values.
         * @returns the localized text, or the fallback dictionary's text.
         */
        const translate = (key, params) => {
          if (locale !== undefined && locale !== null) {
            try {
              const text = locale.bind(NS)(key, params);
              if (typeof text === 'string' && text !== '') return text;
            } catch {
              // Fall through to the packaged dictionary.
            }
          }
          const template = fallback[key] ?? key;
          if (params === undefined) return template;
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
        };

        const colors = {};
        const listeners = new Set();
        const overlay = { open: false, workspaceId: '', name: '', rect: null };
        let pendingTrigger = null;
        const rowStyle = insertStyle('', STYLE_ATTRIBUTE);
        insertStyle(POPOVER_CSS, POPOVER_STYLE_ATTRIBUTE);
        insertStyle(BOOKMARK_CSS, BOOKMARK_STYLE_ATTRIBUTE);

        ctx.effect(() => () => {
          rowStyle.remove();
          document.head.querySelector(`style[${POPOVER_STYLE_ATTRIBUTE}]`)?.remove();
          document.head.querySelector(`style[${BOOKMARK_STYLE_ATTRIBUTE}]`)?.remove();
        }, 'practical-frontend: stylesheets');

        const sessions = ctx.get('sessions');
        const workspaces = ctx.get('workspaces');
        const uiWorkspace = ctx.get('uiWorkspace');
        const bookmarks = createSnapshotStore({ status: 'loading', items: [], error: '' });
        const highlighter = createBookmarkHighlighter();
        ctx.effect(() => () => highlighter.dispose(), 'practical-frontend: bookmark highlight');

        /**
         * Read the stored colour map from this package's Host half.
         */
        const refresh = async () => {
          try {
            const response = await fetch(COLOR_ENDPOINT, { cache: 'no-store' });
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
            await fetch(COLOR_ENDPOINT, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ workspaceId, color: colorId }),
            });
          } catch (error) {
            console.error('practical-frontend: saving the workspace colour failed', error);
          }
        };

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
         * Serialize bookmark reads and writes so a slow refresh can never
         * overwrite a newer saved list in the panel.
         *
         * @param operation - one read or mutation.
         * @returns the operation's result.
         */
        let bookmarkQueue = Promise.resolve();
        const runBookmarkOperation = (operation) => {
          const result = bookmarkQueue.then(operation);
          bookmarkQueue = result.catch(() => {});
          return result;
        };

        /**
         * Read the stored bookmark list from this package's Host half.
         */
        const refreshBookmarks = () => runBookmarkOperation(async () => {
          const current = bookmarks.getSnapshot();
          if (current.items.length === 0) bookmarks.set({ status: 'loading', items: [], error: '' });
          try {
            const response = await fetch(BOOKMARK_ENDPOINT, { cache: 'no-store' });
            if (response.ok === false) throw new Error(`bookmark read failed: ${response.status}`);
            const items = await readBookmarkList(response);
            bookmarks.set({ status: 'ready', items, error: '' });
          } catch (error) {
            console.error('practical-frontend: reading bookmarks failed', error);
            bookmarks.set({ status: 'error', items: current.items, error: translate('loadFailed') });
          }
        });

        /**
         * Create or update one bookmark on the Host half.
         *
         * @param bookmark - bookmark fields, including the title.
         * @returns the complete list after the write.
         */
        const saveBookmark = (bookmark) => runBookmarkOperation(async () => {
          const response = await fetch(BOOKMARK_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'save', bookmark }),
          });
          if (response.ok === false) throw new Error(`bookmark save failed: ${response.status}`);
          const items = await readBookmarkList(response);
          bookmarks.set({ status: 'ready', items, error: '' });
          return items;
        });

        /**
         * Remove one bookmark on the Host half.
         *
         * @param id - bookmark identity.
         * @returns the complete list after the write.
         */
        const deleteBookmark = (id) => runBookmarkOperation(async () => {
          const response = await fetch(BOOKMARK_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id }),
          });
          if (response.ok === false) throw new Error(`bookmark delete failed: ${response.status}`);
          const items = await readBookmarkList(response);
          bookmarks.set({ status: 'ready', items, error: '' });
          return items;
        });

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

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: BOOKMARK_PANEL_ID,
          inject: () => ({
            t: translate,
            bookmarks,
            sessions: sessions.list,
            workspaces: workspaces.list,
            openBookmark: (bookmark) => {
              uiWorkspace.openSession(bookmark.sessionId);
              highlighter.show(bookmark);
            },
            onRefresh: () => {
              void refreshBookmarks();
            },
            onSave: saveBookmark,
            onDelete: deleteBookmark,
          }),
        }, BookmarksPanel));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: BOOKMARK_PANEL_ID,
          order: 20,
          label: () => translate('panelLabel'),
        }, BookmarkGlyph));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'practical-frontend-bookmark-selection',
          order: 41,
          inject: () => ({
            t: translate,
            sessions: sessions.list,
            workspaces: workspaces.list,
            onSave: saveBookmark,
          }),
        }, BookmarkOverlay));

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
        void refreshBookmarks();
      },
    };
  },
});
