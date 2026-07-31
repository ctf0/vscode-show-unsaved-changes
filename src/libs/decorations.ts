import hexToRgba from 'hex-to-rgba'
import * as vscode from 'vscode'
import * as compare from './Compare'
import * as navigation from './navigation'
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

    // file scheme is rendered by native quickdiff (git) — keep the state
    // bookkeeping above (ranges, snapshots, navigation) but skip the visuals
    if (document.uri.scheme === 'file') {
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
        let decor = state.getDecorRangesFor(fileName)

        if (!decor) {
            return
        }

        const snapshot = state.getLastSnapshotFor(fileName)
        const results: compare.ContentComparisonResults[] = await compare.compareStreams(
            snapshot.content,
            document.getText(),
        )

        const add: vscode.Range[] = []
        const del: vscode.DecorationOptions[] = []
        const change: vscode.Range[] = []
        const delAnchors = new Set<number>()

        // ranges
        for (const result of results) {
            const lineNumber = result.lineNumber
            const range = new vscode.Range(lineNumber, 0, lineNumber, 0)

            if (result.del == true) {
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
