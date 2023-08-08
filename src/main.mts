#!/usr/bin/env node --no-warnings --loader tsx

import { Command } from 'commander'
import chalk from 'chalk'

import Device, { KeyType, parseKey, parseKeyType } from './Device.mjs'

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

      await device.close()

      console.log(chalk.greenBright('UID:'), uid.toString(16).padStart(8, '0'))
      const command = [uid, distance, ...groups.flatMap(group => [group.nt, group.ntEnc, group.par])].join(' ')
      console.log(command)
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
        console.log(chalk.redBright(`${block.toString(16).padStart(2, '0')}:`), message)
      }
    }

    await device.close()
  })

void program.parseAsync().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(chalk.redBright('Error:'), message)
  process.exit(1)
})
