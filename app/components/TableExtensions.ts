import { Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, tableEditing, toggleHeader } from "@tiptap/pm/tables";

const tableCellAttributes = {
  colspan: { default: 1, parseHTML: (element: HTMLElement) => Number.parseInt(element.getAttribute("colspan") || "1", 10) || 1, renderHTML: (attributes: { colspan: number }) => attributes.colspan > 1 ? { colspan: attributes.colspan } : {} },
  rowspan: { default: 1, parseHTML: (element: HTMLElement) => Number.parseInt(element.getAttribute("rowspan") || "1", 10) || 1, renderHTML: (attributes: { rowspan: number }) => attributes.rowspan > 1 ? { rowspan: attributes.rowspan } : {} },
  style: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("style"), renderHTML: (attributes: { style?: string | null }) => attributes.style ? { style: attributes.style } : {} },
  width: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("width"), renderHTML: (attributes: { width?: string | null }) => attributes.width ? { width: attributes.width } : {} },
  noBorder: { default: false, parseHTML: (element: HTMLElement) => element.closest("table[data-signature-row='true']") ? true : false, renderHTML: () => ({}) },
};

export const OfficeInlineStyle = Mark.create({
  name: "officeInlineStyle",
  inclusive: true,
  addAttributes() {
    return { style: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("style"), renderHTML: (attributes: { style?: string | null }) => attributes.style ? { style: attributes.style } : {} } };
  },
  parseHTML() { return [{ tag: "span[data-office-inline-style]" }, { tag: "font[data-office-inline-style]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
});

function renderCellAttributes(HTMLAttributes: Record<string, unknown>, noBorder = false) {
  if (noBorder) return { ...HTMLAttributes, style: `${typeof HTMLAttributes.style === "string" ? HTMLAttributes.style.replace(/\bborder(?:-(?:top|right|bottom|left))?\s*:[^;]+;?/gi, "") : ""} border: none;` };
  const existingStyle = typeof HTMLAttributes.style === "string" ? HTMLAttributes.style : "";
  const hasBorder = /\bborder(?:-(?:top|right|bottom|left))?\s*:/i.test(existingStyle);
  const style = hasBorder ? existingStyle : `${existingStyle}${existingStyle && !existingStyle.trim().endsWith(";") ? ";" : ""} border: 1px solid #b7b7b7;`;
  return { ...HTMLAttributes, style };
}

export const TableCell = Node.create({ name: "tableCell", content: "block+", tableRole: "cell", isolating: true, addAttributes() { return tableCellAttributes; }, parseHTML() { return [{ tag: "td" }]; }, renderHTML({ HTMLAttributes, node }) { return ["td", renderCellAttributes(HTMLAttributes, Boolean(node.attrs.noBorder)), 0]; } });
export const TableHeader = Node.create({ name: "tableHeader", content: "block+", tableRole: "header_cell", isolating: true, addAttributes() { return tableCellAttributes; }, parseHTML() { return [{ tag: "th" }]; }, renderHTML({ HTMLAttributes, node }) { return ["th", renderCellAttributes(HTMLAttributes, Boolean(node.attrs.noBorder)), 0]; } });
export const TableRow = Node.create({
  name: "tableRow", content: "(tableCell | tableHeader)+", tableRole: "row",
  addAttributes() { return { height: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("height") || element.style.height || null, renderHTML: (attributes: { height?: string | null }) => attributes.height ? { height: attributes.height } : {} } }; },
  parseHTML() { return [{ tag: "tr" }]; }, renderHTML({ HTMLAttributes }) { return ["tr", HTMLAttributes, 0]; }
});

function createTable(schema: Schema, rows: number, cols: number, withHeaderRow: boolean) {
  const rowNodes = [];
  for (let row = 0; row < rows; row += 1) {
    const cellType = row === 0 && withHeaderRow ? schema.nodes.tableHeader : schema.nodes.tableCell;
    const cells = [];
    for (let col = 0; col < cols; col += 1) {
      const cell = cellType.createAndFill({ noBorder: false });
      if (cell) cells.push(cell);
    }
    rowNodes.push(schema.nodes.tableRow.create(null, cells));
  }
  return schema.nodes.table.create(null, rowNodes);
}

export const Table = Node.create({
  name: "table", content: "tableRow+", group: "block", tableRole: "table", isolating: true,
  addAttributes() {
    return {
      style: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("style"), renderHTML: (attributes: { style?: string | null }) => attributes.style ? { style: attributes.style } : {} },
      width: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("width"), renderHTML: (attributes: { width?: string | null }) => attributes.width ? { width: attributes.width } : {} },
      noBorder: { default: false, parseHTML: (element: HTMLElement) => element.getAttribute("data-signature-row") === "true", renderHTML: (attributes: { noBorder?: boolean }) => attributes.noBorder ? { "data-signature-row": "true" } : {} },
      columnWidths: {
        default: null,
        parseHTML: (element: HTMLElement) => Array.from(element.querySelectorAll(":scope > colgroup > col")).map((col) => { const el = col as HTMLElement; return el.getAttribute("width") || el.style.width || ""; }).filter(Boolean).join(",") || null,
        renderHTML: (attributes: { columnWidths?: string | null }) => attributes.columnWidths ? { "data-column-widths": attributes.columnWidths } : {},
      },
    };
  },
  parseHTML() { return [{ tag: "table" }]; },
  renderHTML({ HTMLAttributes, node }) {
    const columnWidths = typeof node.attrs.columnWidths === "string" ? node.attrs.columnWidths.split(",").filter(Boolean) : [];
    const colgroup = columnWidths.length ? ["colgroup", ...columnWidths.map((width) => ["col", { style: `width: ${width}` }])] : null;
    const noBorder = Boolean(node.attrs.noBorder);
    const baseStyle = noBorder ? "border-collapse: collapse; margin: 8px 0; border: none;" : "border-collapse: collapse; margin: 8px 0;";
    const children = colgroup ? [colgroup, ["tbody", 0]] : ["tbody", 0];
    return ["table", mergeAttributes({ style: baseStyle }, HTMLAttributes), children];
  },
  addCommands() {
    return {
      insertTable: ({ rows = 3, cols = 3, withHeaderRow = true } = {}) => ({ tr, dispatch, editor }) => { const table = createTable(editor.schema, Math.max(1, rows), Math.max(1, cols), withHeaderRow); if (dispatch) { const offset = tr.selection.from + 1; tr.replaceSelectionWith(table).scrollIntoView().setSelection(TextSelection.near(tr.doc.resolve(offset))); } return true; },
      addColumnBefore: () => ({ state, dispatch }) => addColumnBefore(state, dispatch), addColumnAfter: () => ({ state, dispatch }) => addColumnAfter(state, dispatch), deleteColumn: () => ({ state, dispatch }) => deleteColumn(state, dispatch), addRowBefore: () => ({ state, dispatch }) => addRowBefore(state, dispatch), addRowAfter: () => ({ state, dispatch }) => addRowAfter(state, dispatch), deleteRow: () => ({ state, dispatch }) => deleteRow(state, dispatch), deleteTable: () => ({ state, dispatch }) => deleteTable(state, dispatch), toggleHeaderRow: () => ({ state, dispatch }) => toggleHeader("row")(state, dispatch), toggleHeaderColumn: () => ({ state, dispatch }) => toggleHeader("column")(state, dispatch)
    };
  },
  addKeyboardShortcuts() { return { Tab: () => this.editor.commands.goToNextCell(), "Shift-Tab": () => this.editor.commands.goToPreviousCell() }; },
  addProseMirrorPlugins() { return [tableEditing()]; },
});

export const TableExtensions = [Table, TableRow, TableHeader, TableCell, OfficeInlineStyle];

declare module "@tiptap/core" { interface Commands<ReturnType> { table: { insertTable: (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => ReturnType; addColumnBefore: () => ReturnType; addColumnAfter: () => ReturnType; deleteColumn: () => ReturnType; addRowBefore: () => ReturnType; addRowAfter: () => ReturnType; deleteRow: () => ReturnType; deleteTable: () => ReturnType; toggleHeaderRow: () => ReturnType; toggleHeaderColumn: () => ReturnType; }; } }
