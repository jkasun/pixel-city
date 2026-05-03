/**
 * dialect.ts — AAAK Compressed Symbolic Memory Language
 *
 * A structured symbolic format that ANY LLM reads natively at ~30x compression.
 * Not latent vectors. Not English prose. A universal memory compression dialect.
 *
 * FORMAT:
 *   Header:   FILE_NUM|PRIMARY_ENTITY|DATE|TITLE
 *   Zettel:   ZID:ENTITIES|topic_keywords|"key_quote"|WEIGHT|EMOTIONS|FLAGS
 *   Tunnel:   T:ZID<->ZID|label
 *   Arc:      ARC:emotion->emotion->emotion
 */

const EMOTION_CODES: Record<string, string> = {
  vulnerability: 'vul', vulnerable: 'vul',
  joy: 'joy', joyful: 'joy',
  fear: 'fear', mild_fear: 'fear',
  trust: 'trust', trust_building: 'trust',
  grief: 'grief', raw_grief: 'grief',
  wonder: 'wonder', philosophical_wonder: 'wonder',
  rage: 'rage', anger: 'rage',
  love: 'love', devotion: 'love',
  hope: 'hope',
  despair: 'despair', hopelessness: 'despair',
  peace: 'peace', relief: 'relief',
  humor: 'humor', dark_humor: 'humor',
  tenderness: 'tender', raw_honesty: 'raw', brutal_honesty: 'raw',
  self_doubt: 'doubt', anxiety: 'anx', exhaustion: 'exhaust',
  conviction: 'convict', quiet_passion: 'passion',
  warmth: 'warmth', curiosity: 'curious', gratitude: 'grat',
  frustration: 'frust', confusion: 'confuse', satisfaction: 'satis',
  excitement: 'excite', determination: 'determ', surprise: 'surprise',
}

const EMOTION_SIGNALS: Record<string, string> = {
  decided: 'determ', prefer: 'convict', worried: 'anx', excited: 'excite',
  frustrated: 'frust', confused: 'confuse', love: 'love', hate: 'rage',
  hope: 'hope', fear: 'fear', trust: 'trust', happy: 'joy', sad: 'grief',
  surprised: 'surprise', grateful: 'grat', curious: 'curious', wonder: 'wonder',
  anxious: 'anx', relieved: 'relief', satisf: 'satis', disappoint: 'grief',
  concern: 'anx',
}

const FLAG_SIGNALS: Record<string, string> = {
  decided: 'DECISION', chose: 'DECISION', switched: 'DECISION',
  migrated: 'DECISION', replaced: 'DECISION', 'instead of': 'DECISION',
  because: 'DECISION', founded: 'ORIGIN', created: 'ORIGIN', started: 'ORIGIN',
  born: 'ORIGIN', launched: 'ORIGIN', 'first time': 'ORIGIN',
  core: 'CORE', fundamental: 'CORE', essential: 'CORE', principle: 'CORE',
  belief: 'CORE', always: 'CORE', 'never forget': 'CORE',
  'turning point': 'PIVOT', 'changed everything': 'PIVOT', realized: 'PIVOT',
  breakthrough: 'PIVOT', epiphany: 'PIVOT',
  api: 'TECHNICAL', database: 'TECHNICAL', architecture: 'TECHNICAL',
  deploy: 'TECHNICAL', infrastructure: 'TECHNICAL', algorithm: 'TECHNICAL',
  framework: 'TECHNICAL', server: 'TECHNICAL', config: 'TECHNICAL',
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'don', 'now', 'and', 'but', 'or', 'if', 'while', 'that', 'this',
  'these', 'those', 'it', 'its', 'i', 'we', 'you', 'he', 'she', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
  'what', 'which', 'who', 'whom', 'also', 'much', 'many', 'like',
  'because', 'since', 'get', 'got', 'use', 'used', 'using', 'make',
  'made', 'thing', 'things', 'way', 'well', 'really', 'want', 'need',
])

export class Dialect {
  private entityCodes: Record<string, string>
  private skipNames: string[]

  constructor(entities?: Record<string, string>, skipNames?: string[]) {
    this.entityCodes = {}
    if (entities) {
      for (const [name, code] of Object.entries(entities)) {
        this.entityCodes[name] = code
        this.entityCodes[name.toLowerCase()] = code
      }
    }
    this.skipNames = (skipNames || []).map(n => n.toLowerCase())
  }

  encodeEntity(name: string): string | null {
    if (this.skipNames.some(s => name.toLowerCase().includes(s))) return null
    if (this.entityCodes[name]) return this.entityCodes[name]
    if (this.entityCodes[name.toLowerCase()]) return this.entityCodes[name.toLowerCase()]
    for (const [key, code] of Object.entries(this.entityCodes)) {
      if (name.toLowerCase().includes(key.toLowerCase())) return code
    }
    return name.slice(0, 3).toUpperCase()
  }

  encodeEmotions(emotions: string[]): string {
    const codes: string[] = []
    for (const e of emotions) {
      const code = EMOTION_CODES[e] || e.slice(0, 4)
      if (!codes.includes(code)) codes.push(code)
    }
    return codes.slice(0, 3).join('+')
  }

  private detectEmotions(text: string): string[] {
    const textLower = text.toLowerCase()
    const detected: string[] = []
    const seen = new Set<string>()
    for (const [keyword, code] of Object.entries(EMOTION_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(code)) {
        detected.push(code)
        seen.add(code)
      }
    }
    return detected.slice(0, 3)
  }

  private detectFlags(text: string): string[] {
    const textLower = text.toLowerCase()
    const detected: string[] = []
    const seen = new Set<string>()
    for (const [keyword, flag] of Object.entries(FLAG_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(flag)) {
        detected.push(flag)
        seen.add(flag)
      }
    }
    return detected.slice(0, 3)
  }

  private extractTopics(text: string, maxTopics: number = 3): string[] {
    const words = text.match(/[a-zA-Z][a-zA-Z_-]{2,}/g) || []
    const freq: Record<string, number> = {}

    for (const w of words) {
      const wLower = w.toLowerCase()
      if (STOP_WORDS.has(wLower) || wLower.length < 3) continue
      freq[wLower] = (freq[wLower] || 0) + 1
    }

    for (const w of words) {
      const wLower = w.toLowerCase()
      if (STOP_WORDS.has(wLower)) continue
      if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() && freq[wLower]) {
        freq[wLower] += 2
      }
      if ((w.includes('_') || w.includes('-') || /[A-Z]/.test(w.slice(1))) && freq[wLower]) {
        freq[wLower] += 2
      }
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTopics)
      .map(([w]) => w)
  }

  private extractKeySentence(text: string): string {
    const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10)
    if (sentences.length === 0) return ''

    const decisionWords = new Set([
      'decided', 'because', 'instead', 'prefer', 'switched', 'chose',
      'realized', 'important', 'key', 'critical', 'discovered', 'learned',
      'conclusion', 'solution', 'reason', 'why', 'breakthrough', 'insight',
    ])

    const scored: [number, string][] = sentences.map(s => {
      let score = 0
      const sLower = s.toLowerCase()
      for (const w of decisionWords) {
        if (sLower.includes(w)) score += 2
      }
      if (s.length < 80) score += 1
      if (s.length < 40) score += 1
      if (s.length > 150) score -= 2
      return [score, s]
    })

    scored.sort((a, b) => b[0] - a[0])
    let best = scored[0][1]
    if (best.length > 55) best = best.slice(0, 52) + '...'
    return best
  }

  private detectEntitiesInText(text: string): string[] {
    const found: string[] = []

    for (const [name, code] of Object.entries(this.entityCodes)) {
      if (name !== name.toLowerCase() && text.toLowerCase().includes(name.toLowerCase())) {
        if (!found.includes(code)) found.push(code)
      }
    }
    if (found.length > 0) return found

    const words = text.split(/\s+/)
    for (let i = 1; i < words.length; i++) {
      const clean = words[i].replace(/[^a-zA-Z]/g, '')
      if (
        clean.length >= 2 &&
        clean[0] === clean[0].toUpperCase() &&
        clean[0] !== clean[0].toLowerCase() &&
        clean.slice(1) === clean.slice(1).toLowerCase() &&
        !STOP_WORDS.has(clean.toLowerCase())
      ) {
        const code = clean.slice(0, 3).toUpperCase()
        if (!found.includes(code)) found.push(code)
        if (found.length >= 3) break
      }
    }
    return found
  }

  compress(text: string, metadata?: Record<string, string>): string {
    const meta = metadata || {}

    const entities = this.detectEntitiesInText(text)
    const entityStr = entities.slice(0, 3).join('+') || '???'
    const topics = this.extractTopics(text)
    const topicStr = topics.slice(0, 3).join('_') || 'misc'
    const quote = this.extractKeySentence(text)
    const quotePart = quote ? `"${quote}"` : ''
    const emotions = this.detectEmotions(text)
    const emotionStr = emotions.join('+')
    const flags = this.detectFlags(text)
    const flagStr = flags.join('+')

    const source = meta.source_file || ''
    const wing = meta.wing || ''
    const room = meta.room || ''
    const date = meta.date || ''

    const lines: string[] = []

    if (source || wing) {
      const headerParts = [
        wing || '?',
        room || '?',
        date || '?',
        source ? source.replace(/\.[^.]+$/, '') : '?',
      ]
      lines.push(headerParts.join('|'))
    }

    const parts = [`0:${entityStr}`, topicStr]
    if (quotePart) parts.push(quotePart)
    if (emotionStr) parts.push(emotionStr)
    if (flagStr) parts.push(flagStr)

    lines.push(parts.join('|'))
    return lines.join('\n')
  }

  decode(dialectText: string): Record<string, any> {
    const lines = dialectText.trim().split('\n')
    const result: Record<string, any> = { header: {}, arc: '', zettels: [], tunnels: [] }

    for (const line of lines) {
      if (line.startsWith('ARC:')) {
        result.arc = line.slice(4)
      } else if (line.startsWith('T:')) {
        result.tunnels.push(line)
      } else if (line.includes('|') && line.split('|')[0].includes(':')) {
        result.zettels.push(line)
      } else if (line.includes('|')) {
        const parts = line.split('|')
        result.header = {
          file: parts[0] || '',
          entities: parts[1] || '',
          date: parts[2] || '',
          title: parts[3] || '',
        }
      }
    }

    return result
  }

  static countTokens(text: string): number {
    return Math.floor(text.length / 3)
  }

  compressionStats(originalText: string, compressed: string): Record<string, number> {
    const origTokens = Dialect.countTokens(originalText)
    const compTokens = Dialect.countTokens(compressed)
    return {
      original_tokens: origTokens,
      compressed_tokens: compTokens,
      ratio: origTokens / Math.max(compTokens, 1),
      original_chars: originalText.length,
      compressed_chars: compressed.length,
    }
  }
}
