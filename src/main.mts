#!/usr/bin/env node --no-warnings --loader tsx

import { Command } from 'commander'
import chalk from 'chalk'
import { spawnSync } from 'child_process'

import Device, { KeyType, parseKey, parseKeyType } from './Device.mjs'

const nested = (args: string[]): string[] => {
  const stdout = spawnSync('./bin/nested', args, { encoding: 'utf-8' }).stdout
  return stdout
    .trim()
    .split('\n')
    .flatMap(line => {
      const trimmed = line.trim()
      const match = trimmed.match(/Key [0-9]\.\.\. ([a-f0-9]{12})/)
      if (match === null) return []
      return [match[1]]
    })
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
      if (keys.length === 0) throw new Error('No keys found')

      console.log(chalk.greenBright(`Found ${keys.length} key${keys.length === 1 ? '' : 's'}`))

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

void program.parseAsync().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(chalk.redBright('Error:'), message)
  process.exit(1)
})
