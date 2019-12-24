const vscode = require('vscode')
const hexToRgba = require('hex-to-rgba')
const { EOL } = require('os')
const fs = require('fs')
const debounce = require('lodash.debounce')

let decorKeys = []
let overviewConfig = {}
let gutterConfig = {}
let config = {}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

    readConfig(context)

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            readConfig(context)
        }
    })

    // on new document
    vscode.window.onDidChangeVisibleTextEditors(
        debounce(async function (editors) {
            for (const editor of editors) {
                await reApplyDecors(context, editor)
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

    // unify ranges to lines only "no characters change needed"
    // validate to avoid errors
    // unify again to remove new character changes
    let addList = getUniq(validateRange(getUniq(add), editor))
    let delList = getUniq(validateRange(getUniq(del), editor))

    updateCurrentDecorItem({
        add: addList,
        del: delList
    })

    await editor.setDecorations(data.addDecorKey, addList)
    await editor.setDecorations(data.delDecorKey, delList)

    return
}

function validateRange(ranges, editor) {
    return ranges.map((range) => {
        return editor.document.validateRange(range)
    })
}

async function reApplyDecors(context, editor) {
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

function changeIconColor(context, type, color) {
    return fs.writeFile(
        context.asAbsolutePath(`./img/${type}.svg`),
        `<svg width="10" height="40" viewPort="0 0 10 40" xmlns="http://www.w3.org/2000/svg"><polygon points="5,0 10,0 10,40 5,40" fill="${color}"/></svg>`,
        () => { }
    )
}

async function initDecorator(context) {
    let key = await getDecorByKey()

    if (!key) {
        decorKeys.push({
            name: getCurrentFileName(),
            addDecorKey: vscode.window.createTextEditorDecorationType({
                gutterIconPath: context.asAbsolutePath('./img/add.svg'),
                gutterIconSize: gutterConfig.size,
                overviewRulerColor: hexToRgba(overviewConfig.add, overviewConfig.opacity),
                overviewRulerLane: 2,
                isWholeLine: config.wholeLine
            }),
            delDecorKey: vscode.window.createTextEditorDecorationType({
                gutterIconPath: context.asAbsolutePath('./img/del.svg'),
                gutterIconSize: gutterConfig.size,
                overviewRulerColor: hexToRgba(overviewConfig.del, overviewConfig.opacity),
                overviewRulerLane: 2,
                isWholeLine: config.wholeLine
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

function readConfig(context) {
    config = vscode.workspace.getConfiguration('show-unsaved-changes')
    overviewConfig = config.styles.overview
    gutterConfig = config.styles.gutter

    changeIconColor(context, 'add', gutterConfig.add)
    changeIconColor(context, 'del', gutterConfig.del)
}

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
