import hexToRgba from 'hex-to-rgba';
import pDebounce from 'p-debounce';
import * as vscode from 'vscode';
import * as compare from './Compare';
import * as utils from './utils';

const decorRanges: any = [];
const documentsContent: any = [];

export async function activate(context) {
    await utils.readConfig();
    // await utils.checkForGitPresence(context);
    utils.checkForOutputOption(context);

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(utils.PKG_NAME)) {
            await utils.readConfig();
            // await utils.checkForGitPresence(context);
            utils.checkForOutputOption(context);
        }
    });

    // on start
    for (const editor of vscode.window.visibleTextEditors) {
        await initDecorator(editor.document);
    }

    context.subscriptions.push(
        // on new document
        // @ts-ignore
        vscode.window.onDidChangeVisibleTextEditors(async (editors: vscode.TextEditor[]) => {
            for (const editor of editors) {
                await reApplyDecors(editor);
            }
        }),

        // on close
        vscode.workspace.onDidCloseTextDocument(async (document: vscode.TextDocument) => {
            if (document && document.isClosed && hasContentFor(document.fileName)) {
                await resetAll(document.fileName);
            }
        }),

        // on save
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            if (hasContentFor(document.fileName) && utils.config.clearOnSave) {
                await resetAll(document.fileName);
            }
        }),

        // on typing
        vscode.workspace.onDidChangeTextDocument(
            await pDebounce(async (e: vscode.TextDocumentChangeEvent) => {
                const { document } = e;
                const editor = vscode.window.activeTextEditor;

                if (editor && editor.document == document) {
                    const { version } = document;

                    // full undo
                    if (
                        version > 1 &&
                        contentNotChanged(document)
                    ) {
                        await resetAll(document.fileName);
                        await initDecorator(document);
                    } else {
                        await updateDecors(document);
                    }
                }
            }, utils.config.debounceTime),
        ),
    );
}

/* Decors ------------------------------------------------------------------- */
// init
function initDecorator(document: vscode.TextDocument) {
    return new Promise((resolve, reject) => {
        const { fileName, uri } = document;

        if (!['file', 'untitled'].includes(uri.scheme)) {
            return reject();
        }

        if (hasContentFor(fileName)) {
            return reject();
        }

        decorRanges.push({
            name      : fileName,
            addKey    : createDecorator('add'),
            delKey    : createDecorator('del'),
            changeKey : createDecorator('change'),
            ranges    : {
                add    : [],
                del    : [],
                change : [],
            },
            commentThreads: [],
        });

        documentsContent.push({
            name    : fileName,
            history : {
                content   : document.getText(),
                lineCount : document.lineCount,
            },
        });

        resolve(true);
    });
}

function createDecorator(type: string): vscode.TextEditorDecorationType {
    let obj = { isWholeLine: utils.config.wholeLine };

    if (utils.config.showInGutter) {
        obj = Object.assign(obj, {
            gutterIconPath : utils.getImgPath(type),
            gutterIconSize : utils.gutterConfig.size,
        });
    }

    if (utils.config.showInOverView) {
        obj = Object.assign(obj, {
            overviewRulerColor : hexToRgba(utils.overviewConfig[type], utils.overviewConfig.opacity),
            overviewRulerLane  : 2,
        });
    }

    return vscode.window.createTextEditorDecorationType(obj);
}

async function updateDecors(document: vscode.TextDocument) {
    const { languageId, uri, fileName } = document;

    return new Promise(async (resolve, reject) => {
        try {
            let decor = getDecorRangesFor(fileName);
            const snapshot = getLastSnapshotFor(fileName);
            const results: compare.ContentComparisonResults[] = await compare.compareStreams(
                snapshot.content,
                document.getText(),
            );

            const add: any = [];
            const del: any = [];
            const change: any = [];

            // ranges
            for (const result of results) {
                const lineNumber = result.lineNumber;
                const range = new vscode.Range(lineNumber, 0, lineNumber, 0);

                if (result.del == true) {
                    del.push(range);
                }

                if (result.change == true) {
                    change.push(range);
                }

                if (result.add == true) {
                    add.push(range);
                }
            }

            // comments
            const threads: any = [];

            if (utils.commentController !== undefined) {
                const consecutiveLines: any = utils.groupConsecutiveLines(
                    results.filter((line) => line.del || line.change),
                );

                for (const group of consecutiveLines) {
                    const groupComments: vscode.Comment[] = [];

                    for (const item of group) {
                        const lineNumber = item.oldLineNumber || item.lineNumber;
                        const isDelete = item.del == true;
                        const isChange = item.change == true;

                        if (isDelete || isChange) {
                            groupComments.push({
                                author : { name: (isChange ? 'Changed' : 'Deleted') + ` :${lineNumber + 1}` },
                                body   : new vscode.MarkdownString().appendCodeblock(item.lineValue || '...', languageId),
                                mode   : 1,
                            });
                        }
                    }

                    const thread = utils.commentController.createCommentThread(
                        uri,
                        new vscode.Range(group[0].lineNumber, 0, group[0].lineNumber, 0),
                        groupComments,
                    );
                    thread.label = `${utils.PKG_LABEL}: ${utils.getFileNameFromPath(fileName)}`;
                    thread.canReply = false;

                    threads.push(thread);
                }
            }

            decor.commentThreads.forEach((comment: { dispose: () => any; }) => comment.dispose());
            decor = Object.assign(decor, {
                ranges: {
                    add    : add,
                    del    : del,
                    change : change,
                },
                commentThreads: threads,
            });

            // @ts-ignore
            await reApplyDecors(vscode.window.activeTextEditor, decor);

            resolve(true);
        } catch (error) {
            await resetAll(fileName);

            reject(error);
        }
    });
}

async function reApplyDecors(editor: vscode.TextEditor, decor?: any): Promise<unknown> {
    const { document } = editor;
    decor = decor || getDecorRangesFor(document.fileName);

    if (decor) {
        return new Promise((resolve) => {
            const ranges = decor.ranges;

            editor.setDecorations(decor.addKey, ranges.add);
            editor.setDecorations(decor.delKey, ranges.del);
            editor.setDecorations(decor.changeKey, ranges.change);

            resolve(true);
        });
    } else {
        await initDecorator(document);
    }
}

function resetAll(docFilename: string): Promise<unknown> {
    return new Promise((resolve) => {
        const decor = getDecorRangesFor(docFilename);
        const content = findDocumentsContentFor(docFilename);

        if (!decor && !content) {
            return reject();
        }

        if (decor) {
            decor.addKey.dispose();
            decor.delKey.dispose();
            decor.changeKey.dispose();
            decor.commentThreads.forEach((comment: { dispose: () => any; }) => comment.dispose());

            decorRanges.splice(decorRanges.indexOf(decor), 1);
        }

        if (content) {
            documentsContent.splice(documentsContent.indexOf(content), 1);
        }

        resolve(true);
    });
}

/* Ranges ------------------------------------------------------------------- */
function getDecorRangesFor(docFilename: string): any {
    return decorRanges.find((e) => e.name == docFilename);
}

/* Content ------------------------------------------------------------------ */
function findDocumentsContentFor(docFilename) {
    return documentsContent.find((doc) => doc.name == docFilename);
}

function getLastSnapshotFor(docFilename: string) {
    try {
        const snapshot = findDocumentsContentFor(docFilename);

        return snapshot.history;
    } catch (error) {
        throw new Error(`'${docFilename}' not found`);
    }
}

function contentNotChanged(document: vscode.TextDocument): boolean {
    const snapshot = getLastSnapshotFor(document.fileName);

    if (snapshot && snapshot.lineCount == document.lineCount) {
        return snapshot.content == document.getText();
    }

    return false;
}

function hasContentFor(fileName: string) {
    return documentsContent.some((item) => item.name == fileName);
}

/* -------------------------------------------------------------------------- */

export function deactivate() { }
