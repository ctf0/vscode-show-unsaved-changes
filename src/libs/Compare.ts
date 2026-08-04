import {execa} from 'execa'
import * as fs from 'fs-extra'
import parseGitDiff from 'parse-git-diff'
import {file} from 'tmp-promise'
import * as vscode from 'vscode'
import * as utils from './utils'

export type ContentComparisonResults = {
    lineNumber     : number
    oldLineNumber? : number
    lineValue      : string
    add            : boolean
    change         : boolean
    del            : boolean
}

export async function compareStreams(_old: string, _new: string, scheme: string): Promise<ContentComparisonResults[]> {
    if (_old === _new) {
        return []
    }

    return new Promise(async(resolve, reject) => {
        const results: ContentComparisonResults[] = []

        const file1 = await file()
        await fs.outputFile(file1.path, _old)
        const file2 = await file()
        await fs.outputFile(file2.path, _new)

        try {
            let data = await runDiffCmnd(file1.path, file2.path, _old.trim() == '')
            const diffMatch = data.match(/^diff --git(.*\n?)+/gm)

            if (diffMatch === null) {
                reject(false)

                return
            }

            data = diffMatch[0]

            const outputChannel = utils.outputController

            if (outputChannel !== undefined) {
                outputChannel.clear()
                outputChannel.appendLine(`scheme: ${scheme}`)
                outputChannel.appendLine(data)
            }

            const parsedPatch = parseGitDiff(data)

            if (parsedPatch) {
                for (const file of parsedPatch.files) {
                    for (const chunk of file.chunks) {
                        // console.log(chunk);
                        const changes: any = chunk.changes
                        const lineNumber = chunk.toFileRange.start
                        const isSingleDeletedLine = changes.length == 1 && changes[0].type == 'DeletedLine'

                        for (let i = 0; i < changes.length; i++) {
                            const change = changes[i]
                            const nextChange = changes[i + 1]
                            const isChange = change.type == 'DeletedLine' && nextChange && nextChange.type == 'AddedLine'

                            if (isChange) {
                                results.push({
                                    lineNumber : lineNumber - 1,
                                    lineValue  : change.content,
                                    add        : false,
                                    change     : true,
                                    del        : false,
                                })
                                i++
                            } else {
                                if (change.type == 'AddedLine') {
                                    results.push({
                                        lineNumber : change.lineAfter - 1,
                                        lineValue  : change.content,
                                        add        : true,
                                        change     : false,
                                        del        : false,
                                    })
                                } else {
                                    results.push({
                                        lineNumber,
                                        oldLineNumber : isSingleDeletedLine ? lineNumber : change.lineBefore - 1,
                                        lineValue     : change.content,
                                        add           : false,
                                        change        : false,
                                        del           : true,
                                    })
                                }
                            }
                        }
                    }
                }

                resolve(results)
            } else {
                reject(false)
            }
        } catch (error) {
            reject(error)
        } finally {
            await file1.cleanup()
            await file2.cleanup()
        }
    })
}

async function runDiffCmnd(path1: string, path2: string, isEmptyFile = false) {
    const args = [
        'diff',
        '--no-index',
        '--no-renames',
        `--unified=${isEmptyFile ? 1 : 0}`,
        path1,
        path2,
    ]

    try {
        const {stdout} = await execa(
            utils.config.gitPath,
            args,
            {reject: false, shell: utils.config.terminalShellPath || vscode.env.shell},
        )

        return stdout
    } catch ({message}) {
        return message
    }
}
