import * as vscode from 'vscode'
import * as state from './state'

/* Context ------------------------------------------------------------------ */
export function setContext(val: boolean, key = 'sucFilePath') {
    return vscode.commands.executeCommand('setContext', key, val)
}

/* Navigation --------------------------------------------------------------- */
export function getNearestChangedLineNumber(direction: number): number {
    const editor = vscode.window.activeTextEditor

    if (editor && !state.contentNotChanged(editor.document)) {
        const {document, selection} = editor
        const lineNumbers = getLineNumbersList(document.fileName)

        if (lineNumbers.length) {
            const currentLine = selection.active.line
            let ln: number | undefined

            // loop: after / last item in the list + go next
            if (currentLine >= lineNumbers[lineNumbers.length - 1] && direction === 1) {
                ln = lineNumbers[0]
            }

            // loop: before / first item in the list + go prev
            if (currentLine <= lineNumbers[0] && direction === -1) {
                ln = lineNumbers[lineNumbers.length - 1]
            }

            // normal: inside changes range
            if (ln === undefined) {
                if (direction === -1) {
                    ln = lineNumbers.reverse().find((lineNumber) => currentLine > lineNumber)
                } else {
                    ln = lineNumbers.find((lineNumber) => currentLine < lineNumber)
                }
            }

            if (ln !== undefined) {
                const pos = new vscode.Position(ln, 0)
                editor.selection = new vscode.Selection(pos, pos)
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
            }
        }
    }

    return 0
}

function getLineNumbersList(fileName: string) {
    const decor = state.getDecorRangesFor(fileName)
    const lineNumbers: number[] = []

    if (decor) {
        const {ranges} = decor
        lineNumbers.push(
            ...ranges.add.map((range: vscode.Range) => range.start.line),
            ...ranges.del.map((range: vscode.DecorationOptions) => range.range.start.line),
            ...ranges.change.map((range: vscode.Range) => range.start.line),
        )

        return [...new Set(lineNumbers.sort())]
    }

    return []
}
