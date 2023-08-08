import { SerialPort } from 'serialport'
import { promisify } from 'util'

import { DataFrame, createDataFrame, readDataFrame } from './dataFrames.mjs'
import Status from './Status.mjs'
import Command from './Commands.mjs'

export enum KeyType {
  A = 0x60,
  B = 0x61,
}

export const parseKeyType = (keyType: string) => (keyType.toUpperCase() === 'A' ? KeyType.A : KeyType.B)

export const parseKey = (key: string) => {
  if (!key.match(/^([a-fA-F0-9]{12})$/)) throw new Error('Invalid key format')
  return Buffer.from(key, 'hex')
}

class Device {
  private device: SerialPort

  static connect = async (): Promise<Device> => {
    const ports = await SerialPort.list()
    const port = ports.find(port => port.manufacturer === 'Proxgrind')
    if (!port) throw new Error('No Chameleon device found')
    const device = new Device(port.path)
    await device.enableReaderMode()
    return device
  }

  constructor(path: string) {
    this.device = new SerialPort({ path, baudRate: 115200 })
  }

  async drain(): Promise<void> {
    await promisify(this.device.drain.bind(this.device))()
  }

  async sendCommand(cmd: number, status: number, data = Buffer.alloc(0)): Promise<DataFrame> {
    await this.drain()

    const promise = new Promise<DataFrame>((resolve, reject) => {
      this.device.once('readable', () => {
        const frame = this.device.read() as Buffer | null
        if (!frame) return

        try {
          const response = readDataFrame(frame)

          if (response.cmd !== cmd) throw new Error('Command mismatch')

          if (response.status === Status.PAR_ERR) throw new Error('Parity error')
          if (response.status === Status.DEVICE_MODE_ERROR) throw new Error('Device mode error')
          if (response.status === Status.INVALID_CMD) throw new Error('Invalid command')
          if (response.status === Status.NOT_IMPLEMENTED) throw new Error('Not implemented')
          if (response.status === Status.HF_TAG_NO) throw new Error('No tag found')
          if (response.status === Status.HF_ERRCRC) throw new Error('Data CRC error')
          if (response.status === Status.HF_COLLISION) throw new Error('Collision error')
          if (response.status === Status.HF_ERRBCC) throw new Error('UID BCC error')
          if (response.status === Status.MF_ERRAUTH) throw new Error('Authentication error')
          if (response.status === Status.HF_ERRPARITY) throw new Error('Data parity error')

          resolve(response)
        } catch (err) {
          reject(err)
        }
      })
    })

    const frame = createDataFrame(cmd, status, data)
    this.device.write(frame)

    return promise
  }

  async close(): Promise<void> {
    await promisify(this.device.close.bind(this.device))()
  }

  async getChipId(): Promise<string> {
    const response = await this.sendCommand(Command.DATA_CMD_GET_DEVICE_CHIP_ID, 0x0000)
    return response.data.toString('hex')
  }

  async isInReaderMode(): Promise<boolean> {
    const response = await this.sendCommand(Command.DATA_CMD_GET_DEVICE_MODE, 0x0000)
    return response.data[0] === 0x01
  }

  async enableReaderMode(): Promise<void> {
    await this.sendCommand(Command.DATA_CMD_CHANGE_MODE, 0x0000, Buffer.from([0x0001]))
    if (!(await this.isInReaderMode())) throw new Error('Failed to set reader mode')
  }

  async readMifareBlock(block: number, keyType: KeyType, key: Buffer): Promise<Buffer> {
    const data = Buffer.concat([Buffer.from([keyType, block]), key])
    const response = await this.sendCommand(Command.DATA_CMD_MF1_READ_ONE_BLOCK, 0x00, data)

    if (response.status !== Status.HF_TAG_OK) throw new Error('Failed to read block')

    return response.data
  }

  async writeMifareBlock(block: number, keyType: KeyType, key: Buffer, data: Buffer): Promise<void> {
    const dataBuffer = Buffer.concat([Buffer.from([keyType, block]), key, data])
    const response = await this.sendCommand(Command.DATA_CMD_MF1_WRITE_ONE_BLOCK, 0x00, dataBuffer)

    if (response.status !== Status.HF_TAG_OK) throw new Error('Failed to write block')
  }

  async scanTag14A(): Promise<{ uid: string; sak: string; atqa: string }> {
    const response = await this.sendCommand(Command.DATA_CMD_SCAN_14A_TAG, 0x0000)

    if (response.status !== Status.HF_TAG_OK) throw new Error('Unknown error')

    const uidSize = response.data[10]
    const uid = response.data.subarray(0, uidSize).toString('hex')
    const sak = response.data[12].toString(16).padStart(2, '0')
    const atqa = response.data.subarray(13, 15).toString('hex').toUpperCase()

    return { uid, sak, atqa }
  }

  async testMifareBlockKey(block: number, keyType: KeyType, key: Buffer): Promise<boolean> {
    const data = Buffer.concat([Buffer.from([keyType, block]), key])
    const response = await this.sendCommand(Command.DATA_CMD_MF1_CHECK_ONE_KEY_BLOCK, 0x00, data)
    return response.status === Status.HF_TAG_OK
  }

  async detectNtDistance(
    knownBlock: number,
    knownKeyType: KeyType,
    knownKey: Buffer
  ): Promise<{ uid: number; distance: number }> {
    const data = Buffer.concat([Buffer.from([knownKeyType, knownBlock]), knownKey])
    const response = await this.sendCommand(Command.DATA_CMD_MF1_NT_DIST_DETECT, 0x00, data)
    const uid = response.data.readUInt32BE(0)
    const distance = response.data.readUInt32BE(4)
    return { uid, distance }
  }

  async acquireNestedGroups(
    knownBlock: number,
    knownKeyType: KeyType,
    knownKey: Buffer,
    targetBlock: number,
    targetKeyType: KeyType
  ): Promise<{ nt: number; ntEnc: number; par: number }[]> {
    const data = Buffer.concat([
      Buffer.from([knownKeyType, knownBlock]),
      knownKey,
      Buffer.from([targetKeyType, targetBlock]),
    ])
    const response = await this.sendCommand(Command.DATA_CMD_MF1_NESTED_ACQUIRE, 0x00, data)
    if (response.data.length % 9 !== 0) throw new Error('Invalid response length')

    const groups = []

    for (let i = 0; i < response.data.length; i += 9) {
      const nt = response.data.readUInt32BE(i)
      const ntEnc = response.data.readUInt32BE(i + 4)
      const par = response.data.readUInt8(i + 8)
      groups.push({ nt, ntEnc, par })
    }

    return groups
  }
}

export default Device
