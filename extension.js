const vscode = require('vscode')
const { EOL } = require('os')
const debounce = require('lodash.debounce')

let decorKeys = []
let config

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

    readConfig()

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            readConfig()
        }
    })

    // on new document
    vscode.window.onDidChangeVisibleTextEditors(
        debounce(async function (editors) {
            for (const editor of editors) {
                await reapplyDecors(context, editor)
            }
        }, 200)
    )

    // on close
    vscode.workspace.onDidCloseTextDocument((doc) => {
        resetDecors(context, doc.fileName)
    })

    // on typing
    vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e) {
            let editor = vscode.window.activeTextEditor

            if (editor) {
                let doc = editor.document

                if (doc) {
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

/**
 * no need for delete but lets keep it for now
 */
async function updateGutter(context, changes, editor) {
    let data = await getDecorByKey()
    let add = [...data.ranges.add]
    let del = [...data.ranges.del]

    for (const change of changes) {
        let text = change.text
        let line = change.range.start.line
        let range = new vscode.Range(
            line,
            0,
            line,
            0
        )

        // highlight line on text
        if (text) {
            add.push(range)
        }

        // highlight next line on enter
        if (text.endsWith(EOL)) {
            range = new vscode.Range(
                line + 1,
                0,
                line + 1,
                0
            )
            add.push(range)
        }
    }

    let addList = getUniq(add)
    let delList = getUniq(del)

    updateCurrentDecorItem({
        add: addList,
        del: delList
    })

    await editor.setDecorations(data.addDecorKey, addList)
    await editor.setDecorations(data.delDecorKey, delList)

    return
}

async function reapplyDecors(context, editor) {
    let data = await getDecorByKey(editor.document.fileName)

    if (data) {
        await editor.setDecorations(data.addDecorKey, data.ranges.add)
        await editor.setDecorations(data.delDecorKey, data.ranges.del)
    }

    return
}

function getUniq(arr) {
    return arr.reduce((acc, current) => {
        const x = acc.find((item) => item.start.line === current.start.line)

        if (!x) {
            return acc.concat([current])
        } else {
            return acc
        }
    }, [])
}

async function initDecorator(context) {
    let key = await getDecorByKey()

    if (!key) {
        decorKeys.push({
            name: getCurrentFileName(),
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
            }),
            ranges: {
                add: [],
                del: []
            }
        })
    }
}

function getDecorByKey(name = getCurrentFileName()) {
    return decorKeys.find((e) => e.name == name)
}

function getCurrentFileName() {
    return vscode.window.activeTextEditor.document.fileName
}

async function resetDecors(context, name = getCurrentFileName()) {
    return updateCurrentDecorItem({
        add: [],
        del: []
    }, name)
}

function updateCurrentDecorItem(val, name = getCurrentFileName()) {
    for (let i = 0; i < decorKeys.length; i++) {
        if (decorKeys[i].name == name) {
            decorKeys[i].ranges = val
            break
        }
    }
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
