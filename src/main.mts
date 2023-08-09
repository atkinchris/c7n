#!/usr/bin/env node --no-warnings --loader tsx

import { Command } from 'commander'
import chalk from 'chalk'
import { spawnSync } from 'child_process'

import Device, { KeyType, parseKey, parseKeyType } from './Device.mjs'

const STANDARD_KEYS = ['FFFFFFFFFFFF', 'A0A1A2A3A4A5', 'D3F7D3F7D3F7', '000000000000']

const nested = (args: string[]): Set<string> => {
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

const program = new Command()

program.name('c7n').description('CLI for Chameleon Ultra').version('1.0.0')

program
  .command('info')
  .description('Read a tag in ISO 14443A format')
  .action(async () => {
    const device = await Device.connect()
    console.log(await device.scanTag14A())

    await device.close()
  })

program
  .command('read')
  .description('Read data from a block')
  .argument<number>('<block>', 'block', value => parseInt(value, 10))
  .argument<KeyType>('<key type>', 'key type', parseKeyType)
  .argument<Buffer>('<key>', 'key', parseKey)
  .action(async (block: number, keyType: KeyType, key: Buffer) => {
    const device = await Device.connect()
    const response = await device.readMifareBlock(block, keyType, key)
    await device.close()
    console.log(response.toString('hex'))
  })

program
  .command('write')
  .description('Write data to a block')
  .argument<number>('<block>', 'block', value => parseInt(value, 10))
  .argument<KeyType>('<key type>', 'key type', parseKeyType)
  .argument<Buffer>('<key>', 'key', parseKey)
  .argument<Buffer>('<data>', 'data', data => {
    if (!data.match(/^[a-fA-F0-9]{32}$/)) throw new Error('Invalid data format')
    return Buffer.from(data, 'hex')
  })
  .action(async (block: number, keyType: KeyType, key: Buffer, data: Buffer) => {
    const device = await Device.connect()
    await device.writeMifareBlock(block, keyType, key, data)
    await device.close()
  })

program
  .command('test-key')
  .description('Test a key')
  .argument<number>('<block>', 'block', value => parseInt(value, 10))
  .argument<KeyType>('<key type>', 'key type', parseKeyType)
  .argument<Buffer>('<key>', 'key', parseKey)
  .action(async (block: number, keyType: KeyType, key: Buffer) => {
    const device = await Device.connect()

    if (await device.testMifareBlockKey(block, keyType, key)) {
      console.log(chalk.greenBright('Key is valid'))
    } else {
      console.error(chalk.redBright('Key is invalid'))
    }

    await device.close()
  })

program
  .command('nested')
  .description('Generate the command needed for a hardnested attack')
  .argument<number>('<block>', 'known block', value => parseInt(value, 10))
  .argument<KeyType>('<key type>', 'known key type', parseKeyType)
  .argument<Buffer>('<key>', 'known key', parseKey)
  .argument<number>('<target block>', 'target block', value => parseInt(value, 10))
  .argument<KeyType>('<target key type>', 'target key type', parseKeyType)
  .action(
    async (
      knownBlock: number,
      knownKeyType: KeyType,
      knownKey: Buffer,
      targetBlock: number,
      targetKeyType: KeyType
    ) => {
      const device = await Device.connect()

      const { uid, distance } = await device.detectNtDistance(knownBlock, knownKeyType, knownKey)
      const groups = await device.acquireNestedGroups(knownBlock, knownKeyType, knownKey, targetBlock, targetKeyType)

      const args = [uid, distance, ...groups.flatMap(group => [group.nt, group.ntEnc, group.par])].map(String)

      const keys = nested(args)
      if (keys.size === 0) throw new Error('No keys found')

      console.log(chalk.greenBright(`Found ${keys.size} key${keys.size === 1 ? '' : 's'}`))

      for (const key of keys) {
        try {
          const response = await device.readMifareBlock(targetBlock, targetKeyType, Buffer.from(key, 'hex'))
          console.log(chalk.greenBright(key), response.toString('hex'))
          await device.close()
          return
        } catch (error) {
          // Ignore
        }
      }

      console.error(chalk.redBright('No valid key found'))
      await device.close()
    }
  )

program
  .command('dump')
  .description('Dump all blocks')
  .argument<KeyType>('<key type>', 'known key type', parseKeyType)
  .argument<Buffer>('<key>', 'known key', parseKey)
  .action(async (keyType: KeyType, key: Buffer) => {
    const device = await Device.connect()

    for (let block = 0; block < 64; block++) {
      try {
        const response = await device.readMifareBlock(block, keyType, key)
        console.log(chalk.greenBright(`${block.toString().padStart(2, '0')}:`), response.toString('hex'))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(chalk.redBright(`${block.toString().padStart(2, '0')}:`), message)
      }
    }

    await device.close()
  })

program
  .command('nested-dump')
  .description('Dump all blocks using nested attack')
  .argument('[keys...]', 'known keys')
  .option<number>('-p, --passes [number]', 'number of passes', value => parseInt(value, 10), 2)
  .action(async (providedKeys: string[]) => {
    const options = program.opts<{ passes?: number }>()
    const passes = Math.max(2, options.passes ?? 0)

    const keys = new Set([...STANDARD_KEYS, ...providedKeys].map(key => key.toLowerCase()))
    const blocks = Array(64).fill(null) as Array<null | { key: Buffer; data: Buffer }>
    const device = await Device.connect()

    await device.scanTag14A()

    const testKeys = async (block: number, keysToTest = keys): Promise<string | null> => {
      // Print to stderr so that it doesn't get piped to stdout
      console.error(chalk.gray(`Testing keys for block ${block}`))

      for (const keyString of keysToTest) {
        const key = Buffer.from(keyString, 'hex')
        const response = await device.readMifareBlock(block, KeyType.A, key).catch(() => null)
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

    const attackBlock = async (i: number): Promise<void> => {
      // Skip known blocks
      if (blocks[i] !== null) return

      // Test keys that have been found so far
      await testKeys(i)
      // If a key has now been found, skip to next block
      if (blocks[i] !== null) return

      // Run nested attack
      const { uid, distance } = await device.detectNtDistance(knownBlockIndex, KeyType.A, knownBlock.key)
      const groups = await device.acquireNestedGroups(knownBlockIndex, KeyType.A, knownBlock.key, i, KeyType.A)
      const args = [uid, distance, ...groups.flatMap(group => [group.nt, group.ntEnc, group.par])].map(String)
      const foundKeys = nested(args)
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
  })

void program.parseAsync().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(chalk.redBright('Error:'), message)
  process.exit(1)
})
