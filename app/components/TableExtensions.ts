import { Node, mergeAttributes } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
	addColumnAfter,
	addColumnBefore,
	addRowAfter,
	addRowBefore,
	deleteColumn,
	deleteRow,
	deleteTable,
	goToNextCell,
	goToPreviousCell,
	tableEditing,
	toggleHeader,
} from "@tiptap/pm/tables";

const tableCellAttributes = {
	colspan: {
		default: 1,
	},
	rowspan: {
		default: 1,
	},
};

function renderCellAttributes(HTMLAttributes: Record<string, unknown>, defaults: Record<string, unknown>) {
	return mergeAttributes(defaults, HTMLAttributes);
}

export const TableCell = Node.create({
	name: "tableCell",
	content: "block+",
	tableRole: "cell",
	isolating: true,
	addAttributes() {
		return tableCellAttributes;
	},
	parseHTML() {
		return [{ tag: "td" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"td",
			renderCellAttributes(HTMLAttributes, {
				style: "border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top;",
			}),
			0,
		];
	},
});

export const TableHeader = Node.create({
	name: "tableHeader",
	content: "block+",
	tableRole: "header_cell",
	isolating: true,
	addAttributes() {
		return tableCellAttributes;
	},
	parseHTML() {
		return [{ tag: "th" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"th",
			renderCellAttributes(HTMLAttributes, {
				style: "border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; font-weight: 600; background: #f5f5f5;",
			}),
			0,
		];
	},
});

export const TableRow = Node.create({
	name: "tableRow",
	content: "(tableCell | tableHeader)+",
	tableRole: "row",
	parseHTML() {
		return [{ tag: "tr" }];
	},
	renderHTML({ HTMLAttributes }) {
		return ["tr", HTMLAttributes, 0];
	},
});

function createTable(schema: Schema, rows: number, cols: number, withHeaderRow: boolean) {
	const rowNodes = [];
	for (let row = 0; row < rows; row += 1) {
		const cellType = row === 0 && withHeaderRow ? schema.nodes.tableHeader : schema.nodes.tableCell;
		const cells = [];
		for (let col = 0; col < cols; col += 1) {
			const cell = cellType.createAndFill();
			if (cell) cells.push(cell);
		}
		rowNodes.push(schema.nodes.tableRow.create(null, cells));
	}
	return schema.nodes.table.create(null, rowNodes);
}

export const Table = Node.create({
	name: "table",
	content: "tableRow+",
	group: "block",
	tableRole: "table",
	isolating: true,
	parseHTML() {
		return [{ tag: "table" }];
	},
	renderHTML({ HTMLAttributes }) {
		return [
			"table",
			mergeAttributes({ style: "border-collapse: collapse; width: 100%; margin: 8px 0; table-layout: fixed;" }, HTMLAttributes),
			["tbody", 0],
		];
	},
	addCommands() {
		return {
			insertTable:
				({ rows = 3, cols = 3, withHeaderRow = true } = {}) =>
				({ tr, dispatch, editor }) => {
					const table = createTable(editor.schema, Math.max(1, rows), Math.max(1, cols), withHeaderRow);
					if (dispatch) {
						const offset = tr.selection.from + 1;
						tr.replaceSelectionWith(table).scrollIntoView().setSelection(TextSelection.near(tr.doc.resolve(offset)));
					}
					return true;
				},
			addColumnBefore: () => ({ state, dispatch }) => addColumnBefore(state, dispatch),
			addColumnAfter: () => ({ state, dispatch }) => addColumnAfter(state, dispatch),
			deleteColumn: () => ({ state, dispatch }) => deleteColumn(state, dispatch),
			addRowBefore: () => ({ state, dispatch }) => addRowBefore(state, dispatch),
			addRowAfter: () => ({ state, dispatch }) => addRowAfter(state, dispatch),
			deleteRow: () => ({ state, dispatch }) => deleteRow(state, dispatch),
			deleteTable: () => ({ state, dispatch }) => deleteTable(state, dispatch),
			toggleHeaderRow: () => ({ state, dispatch }) => toggleHeader("row")(state, dispatch),
			toggleHeaderColumn: () => ({ state, dispatch }) => toggleHeader("column")(state, dispatch),
		};
	},
	addKeyboardShortcuts() {
		return {
			Tab: () => this.editor.commands.goToNextCell(),
			"Shift-Tab": () => this.editor.commands.goToPreviousCell(),
		};
	},
	addProseMirrorPlugins() {
		return [tableEditing()];
	},
});

export const TableExtensions = [Table, TableRow, TableHeader, TableCell];

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		table: {
			insertTable: (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) => ReturnType;
			addColumnBefore: () => ReturnType;
			addColumnAfter: () => ReturnType;
			deleteColumn: () => ReturnType;
			addRowBefore: () => ReturnType;
			addRowAfter: () => ReturnType;
			deleteRow: () => ReturnType;
			deleteTable: () => ReturnType;
			toggleHeaderRow: () => ReturnType;
			toggleHeaderColumn: () => ReturnType;
		};
	}
}
