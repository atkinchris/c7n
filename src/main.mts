import { Command } from 'commander'
import chalk from 'chalk'

import Device from './Device.mjs'

const program = new Command()

program.name('c7n').description('CLI for Chameleon Ultra').version('1.0.0')

program
  .command('read14a')
  .description('Read a tag in ISO 14443A format')
  .action(async () => {
    const device = await Device.connect()
    await device.enableReaderMode()
    console.log(await device.scanTag14A())

    await device.close()
  })

void program.parseAsync().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(chalk.redBright('Error:'), message)
  process.exit(1)
})
