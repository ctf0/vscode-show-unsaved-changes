const vscode = require('vscode')
const { EOL } = require('os')
const uniq = require('lodash.uniq')

let current = null
let config

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

    readConfig()

    let editor = vscode.window.activeTextEditor

    if (editor) {
        current = editor.document.fileName
        initDecorator(context)
    }

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            readConfig()
        }
    })

    // on window change
    vscode.window.onDidChangeWindowState((e) => {
        if (e.focused) {
            current = vscode.window.activeTextEditor.document.fileName
        }
    })

    // on file change/close
    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            current = editor.document.fileName
        } else {
            resetDecors(context)
        }
    })

    // on file save
    vscode.workspace.onWillSaveTextDocument(({ document }) => {
        if (document.fileName == current) {
            resetDecors(context)
        }
    })

    // on typing
    vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e) {
            let editor = vscode.window.activeTextEditor

            if (editor) {
                let doc = editor.document

                if (doc) {
                    current = doc.fileName

                    await initDecorator(context)

                    let content = e.contentChanges

                    if (content.length) {
                        await updateGutter(context, content, editor)
                    }
                }
            }
        }
    })
}

async function updateGutter(context, changes, editor) {
    let data = await getFileDecors(context)
    let add = []
    let del = []

    for (const change of changes) {
        let text = change.text

        if (text || text.includes(EOL)) {
            add.push(change.range)
        } else {
            add.splice(add.indexOf(change.range), 1)
            del.push(change.range)
        }
    }

    let addlist = uniq(add.concat(data.ranges.add))
    let dellist = uniq(del.concat(data.ranges.del))

    await updateFileDecors(context, {
        ranges: {
            add: addlist,
            del: dellist
        },
        addDecorKey: data.addDecorKey,
        delDecorKey: data.delDecorKey
    })

    await editor.setDecorations(data.addDecorKey, addlist)
    await editor.setDecorations(data.delDecorKey, dellist)
}

async function initDecorator(context) {
    let data = await getFileDecors(context)

    if (!data.addDecorKey) {
        return updateFileDecors(context, {
            ranges: {
                add: [],
                del: []
            },
            addDecorKey: vscode.window.createTextEditorDecorationType({
                gutterIconPath: context.asAbsolutePath('./img/add.svg'),
                gutterIconSize: config.iconSize,
                overviewRulerColor: 'rgba(47,175,100,0.5)',
                overviewRulerLane: 2
            }),
            delDecorKey: vscode.window.createTextEditorDecorationType({
                gutterIconPath: context.asAbsolutePath('./img/del.svg'),
                gutterIconSize: config.iconSize,
                overviewRulerColor: 'rgba(163,21,21,0.5)',
                overviewRulerLane: 2
            })
        })
    }
}

function resetDecors(context) {
    updateFileDecors(context, {
        ranges: {
            add: [],
            del: []
        },
        addDecorKey: null,
        delDecorKey: null
    })
}

async function getFileDecors(context) {
    return context.workspaceState.get(
        current || vscode.window.activeTextEditor.document.fileName,
        {
            ranges: {
                add: [],
                del: []
            },
            addDecorKey: null,
            delDecorKey: null
        }
    )
}

async function updateFileDecors(context, val) {
    return context.workspaceState.update(
        current || vscode.window.activeTextEditor.document.fileName,
        val
    )
}

function readConfig() {
    return config = vscode.workspace.getConfiguration('show-unsaved-changes')
}

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
