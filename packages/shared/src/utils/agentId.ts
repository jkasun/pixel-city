const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateAgentId(): string {
  let id = ''
  for (let i = 0; i < 16; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)]
  return id
}
