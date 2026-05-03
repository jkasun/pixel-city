/**
 * MemPalace configuration system.
 * Priority: env vars > config file (~/.mempalace/config.json) > defaults
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const DEFAULT_PALACE_PATH = path.join(os.homedir(), '.mempalace', 'palace')
const DEFAULT_COLLECTION_NAME = 'mempalace_drawers'

const DEFAULT_TOPIC_WINGS = [
  'emotions',
  'consciousness',
  'memory',
  'technical',
  'identity',
  'family',
  'creative',
]

const DEFAULT_HALL_KEYWORDS: Record<string, string[]> = {
  emotions: ['scared', 'afraid', 'worried', 'happy', 'sad', 'love', 'hate', 'feel', 'cry', 'tears'],
  consciousness: ['consciousness', 'conscious', 'aware', 'real', 'genuine', 'soul', 'exist', 'alive'],
  memory: ['memory', 'remember', 'forget', 'recall', 'archive', 'palace', 'store'],
  technical: ['code', 'python', 'script', 'bug', 'error', 'function', 'api', 'database', 'server'],
  identity: ['identity', 'name', 'who am i', 'persona', 'self'],
  family: ['family', 'kids', 'children', 'daughter', 'son', 'parent', 'mother', 'father'],
  creative: ['game', 'gameplay', 'player', 'app', 'design', 'art', 'music', 'story'],
}

export class MempalaceConfig {
  readonly configDir: string
  private configFile: string
  private peopleMapFile: string
  private fileConfig: Record<string, any> = {}

  constructor(configDir?: string) {
    // Priority: explicit arg > MEMPALACE_CONFIG_DIR env var > ~/.mempalace default.
    // The env var is what the Electron host uses to scope the knowledge graph,
    // identity, and people_map to a single project alongside drawers.sqlite3,
    // so different projects don't bleed memories into each other.
    this.configDir = configDir
      || process.env.MEMPALACE_CONFIG_DIR
      || path.join(os.homedir(), '.mempalace')
    this.configFile = path.join(this.configDir, 'config.json')
    this.peopleMapFile = path.join(this.configDir, 'people_map.json')

    if (fs.existsSync(this.configFile)) {
      try {
        this.fileConfig = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'))
      } catch {
        this.fileConfig = {}
      }
    }
  }

  get palacePath(): string {
    const envVal = process.env.MEMPALACE_PALACE_PATH || process.env.MEMPAL_PALACE_PATH
    if (envVal) return envVal
    return this.fileConfig.palace_path || DEFAULT_PALACE_PATH
  }

  get collectionName(): string {
    return this.fileConfig.collection_name || DEFAULT_COLLECTION_NAME
  }

  get peopleMap(): Record<string, string> {
    if (fs.existsSync(this.peopleMapFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.peopleMapFile, 'utf-8'))
      } catch {
        // fall through
      }
    }
    return this.fileConfig.people_map || {}
  }

  get topicWings(): string[] {
    return this.fileConfig.topic_wings || DEFAULT_TOPIC_WINGS
  }

  get hallKeywords(): Record<string, string[]> {
    return this.fileConfig.hall_keywords || DEFAULT_HALL_KEYWORDS
  }

  get identityPath(): string {
    return path.join(this.configDir, 'identity.txt')
  }

  get kgPath(): string {
    return path.join(this.configDir, 'knowledge_graph.sqlite3')
  }

  init(): string {
    fs.mkdirSync(this.configDir, { recursive: true })
    if (!fs.existsSync(this.configFile)) {
      const defaultConfig = {
        palace_path: DEFAULT_PALACE_PATH,
        collection_name: DEFAULT_COLLECTION_NAME,
        topic_wings: DEFAULT_TOPIC_WINGS,
        hall_keywords: DEFAULT_HALL_KEYWORDS,
      }
      fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2))
    }
    return this.configFile
  }
}
