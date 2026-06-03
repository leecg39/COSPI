import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from './config.ts'

const algorithm = 'aes-256-gcm'

export const hashPassword = (password: string) => bcrypt.hash(password, 12)

export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

export const encryptSecret = (plainText: string | undefined) => {
  if (!plainText) return undefined
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, config.masterKey, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.')
}

export const decryptSecret = (payload: string | undefined) => {
  if (!payload) return undefined
  const [ivRaw, tagRaw, dataRaw] = payload.split('.')
  if (!ivRaw || !tagRaw || !dataRaw) return undefined
  const iv = Buffer.from(ivRaw, 'base64url')
  const tag = Buffer.from(tagRaw, 'base64url')
  const data = Buffer.from(dataRaw, 'base64url')
  const decipher = createDecipheriv(algorithm, config.masterKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
