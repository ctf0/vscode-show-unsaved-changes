import hexToRgba from 'hex-to-rgba';
import pDebounce from 'p-debounce';
import * as vscode from 'vscode';
import * as compare from './Compare';
import * as utils from './utils';

const decorRanges: utils.DecorRange[] = [];
const documentsContent: utils.DocumentContent[] = [];

export async function activate(context) {
    utils.readConfig();
    // await utils.checkForGitPresence(context);
    utils.checkForOutputOption(context);

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(utils.PKG_NAME)) {
            utils.readConfig();
            // await utils.checkForGitPresence(context);
            utils.checkForOutputOption(context);
        }
    });

    // on start
    for (const editor of vscode.window.visibleTextEditors) {
        try {
            await initDecorator(editor.document);
        } catch (error) {
            // console.error(error);
        }
    }

    context.subscriptions.push(
        // commands
        vscode.commands.registerCommand('showUnsavedChanges.goToPrevChange', () => getNearestChangedLineNumber(-1)),
        vscode.commands.registerCommand('showUnsavedChanges.goToNextChange', () => getNearestChangedLineNumber(1)),

        // on close
        vscode.workspace.onDidCloseTextDocument(async (document: vscode.TextDocument) => {
            const { fileName, isClosed } = document;

            if (document && isClosed && hasContentFor(fileName)) {
                await resetAll(fileName);
            }
        }),

        // on save
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            const { fileName } = document;

            if (hasContentFor(fileName) && utils.config.clearOnSave) {
                await resetAll(fileName);
                await initDecorator(document);
            }
        }),

        // on file change
        vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined) => {
            if (editor) {
                const { document } = editor;

                if (utils.config.schemeTypes.includes(document.uri.scheme) && !isIgnored(document)) {
                    await reApplyDecors(editor);
                    await setContext(!contentNotChanged(document));
                }
            }
        }),

        // on typing
        vscode.workspace.onDidChangeTextDocument(
            await pDebounce(async (e: vscode.TextDocumentChangeEvent) => {
                const { document } = e;
                const editor = getActiveEditor();

                if (editor && editor.document === document) {
                    // full undo
                    if (
                        document.version > 1 &&
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

function isIgnored(document: vscode.TextDocument) {
    return utils.config.schemeTypesIgnore.some((scheme) => scheme == document.uri.scheme);
}

/* Decors ------------------------------------------------------------------- */
// init
function initDecorator(document: vscode.TextDocument) {
    return new Promise((resolve, reject) => {
        const { fileName, uri } = document;
        const fileScheme = uri.scheme;

        if (isIgnored(fileScheme)) {
            return reject(false);
        }

        if (!utils.config.schemeTypes.some((scheme) => scheme == fileScheme)) {
            utils.showMessage(`file scheme type '${fileScheme}' is not supported`);

            return reject(false);
        }

        if (hasContentFor(fileName)) {
            return reject(false);
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

function getActiveEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
}

async function updateDecors(document: vscode.TextDocument) {
    const { languageId, uri, fileName } = document;

    return new Promise(async (resolve, reject) => {
        try {
            let decor = getDecorRangesFor(fileName);

            if (!decor) {
                return reject(false);
            }

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

            await vscode.commands.executeCommand('workbench.action.collapseAllComments');

            decor.commentThreads.map((thread: vscode.CommentThread) => thread.dispose());

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
                                author : { name: `${isChange ? 'Changed' : 'Deleted'} : #${lineNumber + 1}` },
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

            decor = Object.assign(decor, {
                ranges: {
                    add,
                    del,
                    change,
                },
                commentThreads: threads,
            });

            // @ts-ignore
            await reApplyDecors(getActiveEditor(), decor);

            await setContext(true);

            resolve(true);
        } catch (error) {
            console.error(error);

            await resetAll(fileName);

            reject(error);
        }
    });
}

async function reApplyDecors(editor: vscode.TextEditor, decor?: utils.DecorRange | any): Promise<unknown> {
    try {
        const { document } = editor;
        const { fileName, isClosed } = document;

        if (!isClosed) {
            decor = decor || getDecorRangesFor(fileName);

            if (decor) {
                return new Promise((resolve) => {
                    const ranges = decor.ranges;

                    editor.setDecorations(decor.addKey, ranges.add);
                    editor.setDecorations(decor.delKey, ranges.del);
                    editor.setDecorations(decor.changeKey, ranges.change);

                    resolve(true);
                });
            }

            await initDecorator(document);
        }
    } catch (error) {
        // console.error(error);
    }
}

function resetAll(docFilename: string): Promise<unknown> {
    return new Promise(async (resolve, reject) => {
        const decor = getDecorRangesFor(docFilename);
        const content = findDocumentsContentFor(docFilename);

        await setContext(false);

        if (!decor && !content) {
            return reject(false);
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
function getDecorRangesFor(docFilename: string): utils.DecorRange | undefined {
    return decorRanges.find((e) => e.name == docFilename);
}

/* Content ------------------------------------------------------------------ */
function findDocumentsContentFor(docFilename: string): utils.DocumentContent | undefined {
    return documentsContent.find((doc) => doc.name == docFilename);
}

function getLastSnapshotFor(docFilename: string) {
    try {
        const snapshot = findDocumentsContentFor(docFilename);

        return snapshot!.history;
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

function hasContentFor(fileName: string): boolean {
    return documentsContent.some((item) => item.name == fileName);
}

function setContext(val, key = 'sucFilePath') {
    return vscode.commands.executeCommand('setContext', key, val);
}

function getNearestChangedLineNumber(direction: number): number {
    const editor = getActiveEditor();

    if (editor && !contentNotChanged(editor.document)) {
        const { document, selection } = editor;
        const lineNumbers = getLineNumbersList(document.fileName);

        if (lineNumbers.length) {
            const currentLine = selection.active.line;
            let ln: number | undefined;

            // loop: after / last item in the list + go next
            if (currentLine >= lineNumbers[lineNumbers.length - 1] && direction === 1) {
                ln = lineNumbers[0];
            }

            // loop: before / first item in the list + go prev
            if (currentLine <= lineNumbers[0] && direction === -1) {
                ln = lineNumbers[lineNumbers.length - 1];
            }

            // normal: inside changes range
            if (ln === undefined) {
                if (direction === -1) {
                    ln = lineNumbers.reverse().find((lineNumber) => currentLine > lineNumber);
                } else {
                    ln = lineNumbers.find((lineNumber) => currentLine < lineNumber);
                }
            }

            if (ln !== undefined) {
                const pos = new vscode.Position(ln, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        }
    }

    return 0;
}

function getLineNumbersList(fileName) {
    const decor = getDecorRangesFor(fileName);
    const lineNumbers: number[] = [];

    if (decor) {
        const { ranges } = decor;
        lineNumbers.push(
            ...ranges.add.map((range: vscode.Range) => range.start.line),
            ...ranges.del.map((range: vscode.Range) => range.start.line),
            ...ranges.change.map((range: vscode.Range) => range.start.line),
        );

        return [...new Set(lineNumbers.sort())];
    }

    return [];
}

/* -------------------------------------------------------------------------- */

export function deactivate() { }
