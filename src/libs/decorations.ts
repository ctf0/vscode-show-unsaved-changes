import hexToRgba from 'hex-to-rgba'
import * as vscode from 'vscode'
import * as compare from './Compare'
import * as deletedContent from './deletedContent'
import * as navigation from './navigation'
import * as quickDiff from './quickDiff'
import * as state from './state'
import * as utils from './utils'

/* Helpers ------------------------------------------------------------------ */
export function isIgnored(document: vscode.TextDocument) {
    return utils.config.schemeTypesIgnore.some((scheme: string) => scheme == document.uri.scheme)
}

function createDecorator(type: string): vscode.TextEditorDecorationType {
    let obj = {}

    if (utils.config.showInGutter) {
        obj = Object.assign(obj, {
            gutterIconPath : utils.getImgPath(type),
            gutterIconSize : utils.gutterConfig.size,
        })
    }

    if (utils.config.showInOverView) {
        obj = Object.assign(obj, {
            overviewRulerColor : hexToRgba(utils.overviewConfig[type], utils.overviewConfig.opacity),
            overviewRulerLane  : 2,
        })
    }

    return vscode.window.createTextEditorDecorationType(obj)
}

/* Lifecycle ---------------------------------------------------------------- */
export function initDecorator(document: vscode.TextDocument): void {
    const {fileName, uri} = document
    const fileScheme = uri.scheme

    if (isIgnored(document)) {
        return
    }

    if (!utils.config.schemeTypes.some((scheme: string) => scheme == fileScheme)) {
        utils.showMessage(`file scheme type '${fileScheme}' is not supported`)

        return
    }

    if (state.hasContentFor(fileName)) {
        return
    }

    state.addDecorRange({
        name      : fileName,
        addKey    : createDecorator('add'),
        delKey    : createDecorator('del'),
        changeKey : createDecorator('change'),
        ranges    : {
            add    : [],
            del    : [],
            change : [],
        },
    })

    state.addDocumentContent({
        name    : fileName,
        history : {
            content   : document.getText(),
            lineCount : document.lineCount,
        },
    })

    quickDiff.notifySnapshotChanged(fileName)
}

export function reApplyDecors(editor: vscode.TextEditor | undefined, updateDecors: boolean = false, decor?: utils.DecorRange): void {
    if (!editor) {
        return
    }

    const {document} = editor
    const {isClosed} = document

    if (isClosed) {
        return
    }

    decor = decor || state.getDecorRangesFor(document.fileName)

    if (!decor) {
        initDecorator(document)

        return
    }

    if (document.uri.scheme !== 'untitled') {
        return
    }

    if (updateDecors) {
        decor.addKey.dispose()
        decor.delKey.dispose()
        decor.changeKey.dispose()

        decor = Object.assign(decor, {
            addKey    : createDecorator('add'),
            delKey    : createDecorator('del'),
            changeKey : createDecorator('change'),
        })
    }

    const {ranges} = decor

    editor.setDecorations(decor.addKey, ranges.add)
    editor.setDecorations(decor.delKey, ranges.del)
    editor.setDecorations(decor.changeKey, ranges.change)
}

async function updateDecors(document: vscode.TextDocument) {
    const {fileName} = document

    try {
        // native scm owns this file → ext does nothing (no ranges, no diff output)
        if (!(await quickDiff.isExtTracked(document.uri))) {
            return
        }

        let decor = state.getDecorRangesFor(fileName)

        if (!decor) {
            return
        }

        const snapshot = state.getLastSnapshotFor(fileName)
        const results: compare.ContentComparisonResults[] = await compare.compareStreams(
            snapshot.content,
            document.getText(),
            document.uri.scheme,
        )

        if (document.uri.scheme === 'untitled') {
            deletedContent.storeDeletedLines(fileName, results, document.lineCount)

            try {
                await deletedContent.updateCommentThreads(document)
            } catch (error) {
                // console.error(error);
            }
        }

        const add: vscode.Range[] = []
        const del: vscode.DecorationOptions[] = []
        const change: vscode.Range[] = []
        const delAnchors = new Set<number>()
        const changeLines = new Set(results.filter((result) => result.change).map((result) => result.lineNumber))

        // ranges
        for (const result of results) {
            const lineNumber = result.lineNumber
            const range = new vscode.Range(lineNumber, 0, lineNumber, 0)

            // a line that is both a deletion anchor and a change shows as change
            if (result.del == true && !changeLines.has(lineNumber)) {
                const anchor = Math.max(0, Math.min(lineNumber, document.lineCount - 1))

                if (!delAnchors.has(anchor)) {
                    delAnchors.add(anchor)

                    const option: vscode.DecorationOptions = {
                        range : new vscode.Range(anchor, 0, anchor, 0),
                    }

                    del.push(option)
                }
            }

            if (result.change == true) {
                change.push(range)
            }

            if (result.add == true) {
                add.push(range)
            }
        }

        decor = Object.assign(decor, {
            ranges : {
                add,
                del,
                change,
            },
        })

        const editor = vscode.window.visibleTextEditors.find((e) => e.document === document)

        if (editor) {
            reApplyDecors(editor, false, decor)
        }

        await navigation.setContext(true)
    } catch (error) {
        // console.error(error);

        await resetAll(fileName)
    }
}

export async function resetAll(docFilename: string): Promise<void> {
    const decor = state.getDecorRangesFor(docFilename)
    const content = state.findDocumentsContentFor(docFilename)

    await navigation.setContext(false)

    if (!decor && !content) {
        return
    }

    if (decor) {
        decor.addKey.dispose()
        decor.delKey.dispose()
        decor.changeKey.dispose()

        state.removeDecorRange(decor)
    }

    if (content) {
        state.removeDocumentContent(content)
    }

    deletedContent.disposeThreadsFor(docFilename)
    state.deletedLines.delete(docFilename)
    state.deletedAt.delete(docFilename)
}

export async function visibleEditors(updateDecors: boolean = false) {
    for (const editor of vscode.window.visibleTextEditors) {
        try {
            reApplyDecors(editor, updateDecors)
        } catch (error) {
            // console.error(error);
        }
    }
}

/* Events ------------------------------------------------------------------- */
export async function onTextDocumentChange(e: vscode.TextDocumentChangeEvent) {
    const {document} = e
    const editor = vscode.window.activeTextEditor

    if (editor && editor.document === document) {
        if (document.version > 1 && state.contentNotChanged(document)) {
            await resetAll(document.fileName)

            return initDecorator(document)
        }

        return updateDecors(document)
    }
}
