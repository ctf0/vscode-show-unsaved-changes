const vscode = require('vscode')
const hexToRgba = require('hex-to-rgba')
const fs = require('fs')
const debounce = require('lodash.debounce')
const Diff = require('diff-compare')

let decorRanges = []
let config = {}
let gutterConfig = {}
let overviewConfig = {}
let commentController

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    await readConfig(context)

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            await readConfig(context)
        }
    })

    let wsHasGit = false

    if (config.disableWhenScm) {
        wsHasGit = await checkForGitPresense()
    }

    if (!wsHasGit) {
        // on close
        vscode.workspace.onDidCloseTextDocument(
            debounce(async function (doc) {
                if (doc) {
                    await resetDecors(doc.fileName)
                }
            }, 100)
        )

        // on new document
        vscode.window.onDidChangeVisibleTextEditors(
            debounce(async function (editors) {
                for (const editor of editors) {
                    await reApplyDecors(editor)
                }
            }, 500)
        )

        // comments
        commentController = vscode.comments.createCommentController('show-unsaved-changes', 'Show Unsaved Changes')
        context.subscriptions.push(commentController)

        // on typing
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (e) {
                let editor = vscode.window.activeTextEditor
                let { document } = e

                if (editor && editor.document == document) {
                    // init
                    if (!getDecorRangesByName()) {
                        await initDecorator(context, document)
                    }

                    // full undo / save
                    // untitled 'isDirty' is different from normal files
                    if (!document.isDirty && document.version > 0 && !document.isUntitled) {
                        await resetDecors()
                    } else {
                        await updateGutter(editor, document)
                    }
                }
            }
        })
    }
}

// init
function initDecorator(context, document) {
    return new Promise((resolve) => {
        let fileName = getCurrentFileName()

        decorRanges.push({
            name: fileName,
            original: document.getText(),
            addKey: createDecorator(context, 'add'),
            delKey: createDecorator(context, 'del'),
            ranges: {
                add: [],
                del: []
            },
            commentThreads: []
        })

        resolve()
    })
}

function createDecorator(context, type) {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: context.asAbsolutePath(`./img/${type}.svg`),
        gutterIconSize: gutterConfig.size,
        overviewRulerColor: hexToRgba(overviewConfig[type], overviewConfig.opacity),
        overviewRulerLane: 2,
        isWholeLine: config.wholeLine
    })
}

let updateGutter = debounce(function (editor, document) {
    return new Promise((resolve, reject) => {
        try {
            let data = getDecorRangesByName()
            let add = []
            let del = []
            let threads = data.commentThreads
            let { languageId, uri } = document
            let diff = Diff.build({
                base: data.original,
                compare: document.getText()
            })

            diff.compare.forEach((item, i) => {
                let range = new vscode.Range(i, 0, i, 0)

                if (item.type == 'delete' || item.type == 'replace') {
                    del.push(range)

                    let isDelete = item.type == 'delete'
                    let msg = (isDelete ? diff.base[i].value : item.value) || '\\n'
                    let found = threads.findIndex((item) => item.range.isEqual(range) && item.uri == uri)
                    let comment = {
                        "author": { name: item.type },
                        "body": new vscode.MarkdownString().appendCodeblock(msg, languageId),
                        "mode": vscode.CommentMode.Preview
                    }

                    if (found > -1) {
                        threads[found].comments = [...threads[found].comments, comment]
                    } else {
                        let thread = commentController.createCommentThread(uri, range, [comment])
                        thread.label = `Show Unsaved Changes: line #${i + 1}`

                        threads.push(thread)
                    }

                } else if (item.type == 'insert') {
                    add.push(range)
                }
            })

            updateCurrentDecorRanges({
                ranges: {
                    add: add,
                    del: del
                },
                commentThreads: threads
            })

            editor.setDecorations(data.addKey, add)
            editor.setDecorations(data.delKey, del)

            resolve()
        } catch (error) {
            reject()
        }
    })
}, 2 * 1000, { trailing: true, leading: true })

async function reApplyDecors(editor) {
    let data = await getDecorRangesByName(editor.document.fileName)

    if (data) {
        return new Promise((resolve) => {
            editor.setDecorations(data.addKey, data.ranges.add)
            editor.setDecorations(data.delKey, data.ranges.del)

            resolve()
        })
    }
}

// ranges
function getDecorRangesByName(name = getCurrentFileName()) {
    return decorRanges.find((e) => e.name == name)
}

function resetDecors(name = getCurrentFileName()) {
    return new Promise((resolve) => {
        for (let i = 0; i < decorRanges.length; i++) {
            let item = decorRanges[i]

            if (item.name == name) {
                item.addKey.dispose()
                item.delKey.dispose()
                item.commentThreads.forEach((one) => one.dispose())
                decorRanges.splice(i, 1)
                break
            }
        }

        resolve()
    })
}

function updateCurrentDecorRanges(val, name = getCurrentFileName()) {
    for (let i = 0; i < decorRanges.length; i++) {
        let item = decorRanges[i]

        if (item.name == name) {
            item = Object.assign(item, val)
            break
        }
    }
}

// config
async function readConfig(context) {
    config = await vscode.workspace.getConfiguration('show-unsaved-changes')
    overviewConfig = config.styles.overview
    gutterConfig = config.styles.gutter

    await changeIconColor(context, 'add', gutterConfig.add)
    await changeIconColor(context, 'del', gutterConfig.del)
}

function changeIconColor(context, type, color) {
    return new Promise((resolve) => {
        return fs.writeFile(
            context.asAbsolutePath(`./img/${type}.svg`),
            `<svg width="10" height="40" viewPort="0 0 10 40" xmlns="http://www.w3.org/2000/svg"><polygon points="5,0 10,0 10,40 5,40" fill="${color}"/></svg>`,
            () => {
                resolve()
            }
        )
    })
}

// util
function getCurrentFileName() {
    try {
        return vscode.window.activeTextEditor.document.fileName
    } catch (error) {
    }
}

async function checkForGitPresense() {
    let files = await vscode.workspace.findFiles('.gitignore')

    return !!files.length
}

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
