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

export async function compareStreams(_old: string, _new: string): Promise<ContentComparisonResults[]> {
    return new Promise(async(resolve, reject) => {
        const results: ContentComparisonResults[] = []

        const file1 = await file()
        await fs.outputFile(file1.path, _old)
        const file2 = await file()
        await fs.outputFile(file2.path, _new)

        try {
            let data = await runDiffCmnd(file1.path, file2.path, _old.trim() == '')
            data = data.match(/^diff --git(.*\n?)+/gm)[0]

            const outputChannel = utils.outputController

            if (outputChannel !== undefined) {
                outputChannel.clear()
                outputChannel.appendLine(data)
            }

            const parsedPatch = parseGitDiff(data)

            if (parsedPatch) {
                for (const file of parsedPatch.files) {
                    for (const chunk of file.chunks) {
                        // console.log(chunk);
                        const changes: any = chunk.changes
                        const lineNumber = chunk.toFileRange.start

                        for (let i = 0; i < changes.length; i++) {
                            const change = changes[i]

                            if (change.type == 'DeletedLine') {
                                let runEnd = i

                                while (runEnd < changes.length && changes[runEnd].type == 'DeletedLine') {
                                    runEnd++
                                }

                                // deleted lines paired with added lines = replaced
                                // content ("change") → no del entries, no comment thread
                                const followedByAddition = changes[runEnd]?.type == 'AddedLine'

                                if (followedByAddition) {
                                    let addEnd = runEnd

                                    while (addEnd < changes.length && changes[addEnd].type == 'AddedLine') {
                                        addEnd++
                                    }

                                    // deleted lines with no matching addition
                                    // (more deletions than additions) stay pure deletions
                                    const pureDelCount = runEnd - i - (addEnd - runEnd)

                                    for (let k = i; k < i + Math.max(0, pureDelCount); k++) {
                                        results.push({
                                            lineNumber    : lineNumber - 1,
                                            oldLineNumber : changes[k].lineBefore - 1,
                                            lineValue     : changes[k].content,
                                            add           : false,
                                            change        : false,
                                            del           : true,
                                        })
                                    }

                                    results.push({
                                        lineNumber : lineNumber - 1,
                                        lineValue  : changes[runEnd - 1].content,
                                        add        : false,
                                        change     : true,
                                        del        : false,
                                    })
                                    i = runEnd // first added line is covered by the change marker above
                                } else {
                                    // pure deletion → del entries (gutter red bar + comment thread)
                                    const isSingleDeletedLine = runEnd - i === 1

                                    for (let k = i; k < runEnd; k++) {
                                        results.push({
                                            lineNumber,
                                            oldLineNumber : isSingleDeletedLine ? lineNumber : changes[k].lineBefore - 1,
                                            lineValue     : changes[k].content,
                                            add           : false,
                                            change        : false,
                                            del           : true,
                                        })
                                    }

                                    i = runEnd - 1
                                }
                            } else if (change.type == 'AddedLine') {
                                results.push({
                                    lineNumber : change.lineAfter - 1,
                                    lineValue  : change.content,
                                    add        : true,
                                    change     : false,
                                    del        : false,
                                })
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
    try {
        const args = [
            'diff',
            '--no-index',
            '--no-renames',
            `--unified=${isEmptyFile ? 1 : 0}`,
            path1,
            path2,
        ]

        const {stdout} = await execa(
            utils.config.gitPath,
            args,
            {shell: utils.config.terminalShellPath || vscode.env.shell},
        )

        return stdout
    } catch ({message}) {
        return message
    }
}
