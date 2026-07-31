import * as vscode from 'vscode'
import * as utils from './utils'

/* Shared state ------------------------------------------------------------- */
const decorRanges: utils.DecorRange[] = []
const documentsContent: utils.DocumentContent[] = []

/* Mutations ---------------------------------------------------------------- */
export function addDecorRange(decor: utils.DecorRange) {
    decorRanges.push(decor)
}

export function removeDecorRange(decor: utils.DecorRange) {
    decorRanges.splice(decorRanges.indexOf(decor), 1)
}

export function addDocumentContent(doc: utils.DocumentContent) {
    documentsContent.push(doc)
}

export function removeDocumentContent(doc: utils.DocumentContent) {
    documentsContent.splice(documentsContent.indexOf(doc), 1)
}

/* Lookups ------------------------------------------------------------------ */
export function getDecorRangesFor(fileName: string): utils.DecorRange | undefined {
    return decorRanges.find((e) => e.name == fileName)
}

export function findDocumentsContentFor(fileName: string): utils.DocumentContent | undefined {
    return documentsContent.find((doc) => doc.name == fileName)
}

export function getLastSnapshotFor(fileName: string) {
    const snapshot = findDocumentsContentFor(fileName)

    if (!snapshot) {
        throw new Error(`'${fileName}' not found`)
    }

    return snapshot.history
}

export function contentNotChanged(document: vscode.TextDocument): boolean {
    const snapshot = getLastSnapshotFor(document.fileName)

    if (snapshot && snapshot.lineCount == document.lineCount) {
        return snapshot.content == document.getText()
    }

    return false
}

export function hasContentFor(fileName: string): boolean {
    return documentsContent.some((item) => item.name == fileName)
}
