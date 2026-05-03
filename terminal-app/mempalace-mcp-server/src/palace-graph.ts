/**
 * palace-graph.ts — Graph traversal layer for MemPalace
 *
 * Builds a navigable graph from the palace structure:
 *   Nodes = rooms (named ideas)
 *   Edges = shared rooms across wings (tunnels)
 */

import { DrawerStore, DrawerMetadata } from './storage.js'
import { MempalaceConfig } from './config.js'

interface RoomNode {
  wings: string[]
  halls: string[]
  count: number
  dates: string[]
}

interface GraphEdge {
  room: string
  wing_a: string
  wing_b: string
  hall: string
  count: number
}

function buildGraph(store: DrawerStore): { nodes: Record<string, RoomNode>; edges: GraphEdge[] } {
  const allMeta = store.getAllMetadata()

  const roomData: Record<string, { wings: Set<string>; halls: Set<string>; count: number; dates: Set<string> }> = {}

  for (const meta of allMeta) {
    const room = meta.room || ''
    const wing = meta.wing || ''
    const hall = meta.hall || ''
    const date = meta.date || ''

    if (!room || room === 'general' || !wing) continue

    if (!roomData[room]) {
      roomData[room] = { wings: new Set(), halls: new Set(), count: 0, dates: new Set() }
    }
    roomData[room].wings.add(wing)
    if (hall) roomData[room].halls.add(hall)
    if (date) roomData[room].dates.add(date)
    roomData[room].count++
  }

  // Build edges from rooms that span multiple wings
  const edges: GraphEdge[] = []
  for (const [room, data] of Object.entries(roomData)) {
    const wings = [...data.wings].sort()
    if (wings.length >= 2) {
      for (let i = 0; i < wings.length; i++) {
        for (let j = i + 1; j < wings.length; j++) {
          for (const hall of data.halls) {
            edges.push({ room, wing_a: wings[i], wing_b: wings[j], hall, count: data.count })
          }
        }
      }
    }
  }

  // Convert sets to arrays
  const nodes: Record<string, RoomNode> = {}
  for (const [room, data] of Object.entries(roomData)) {
    const sortedDates = [...data.dates].sort()
    nodes[room] = {
      wings: [...data.wings].sort(),
      halls: [...data.halls].sort(),
      count: data.count,
      dates: sortedDates.slice(-5),
    }
  }

  return { nodes, edges }
}

function fuzzyMatch(query: string, nodes: Record<string, RoomNode>, n: number = 5): string[] {
  const queryLower = query.toLowerCase()
  const scored: [string, number][] = []

  for (const room of Object.keys(nodes)) {
    if (queryLower === room) {
      scored.push([room, 2.0])
    } else if (room.includes(queryLower)) {
      scored.push([room, 1.0])
    } else if (queryLower.split('-').some(word => room.includes(word))) {
      scored.push([room, 0.5])
    }
  }

  scored.sort((a, b) => b[1] - a[1])
  return scored.slice(0, n).map(([r]) => r)
}

export function traverse(startRoom: string, store: DrawerStore, maxHops: number = 2): any {
  const { nodes } = buildGraph(store)

  if (!nodes[startRoom]) {
    return { error: `Room '${startRoom}' not found`, suggestions: fuzzyMatch(startRoom, nodes) }
  }

  const start = nodes[startRoom]
  const visited = new Set([startRoom])
  const results: any[] = [{
    room: startRoom,
    wings: start.wings,
    halls: start.halls,
    count: start.count,
    hop: 0,
  }]

  // BFS traversal
  const frontier: [string, number][] = [[startRoom, 0]]
  while (frontier.length > 0) {
    const [currentRoom, depth] = frontier.shift()!
    if (depth >= maxHops) continue

    const current = nodes[currentRoom]
    if (!current) continue
    const currentWings = new Set(current.wings)

    for (const [room, data] of Object.entries(nodes)) {
      if (visited.has(room)) continue
      const sharedWings = data.wings.filter(w => currentWings.has(w))
      if (sharedWings.length > 0) {
        visited.add(room)
        results.push({
          room,
          wings: data.wings,
          halls: data.halls,
          count: data.count,
          hop: depth + 1,
          connected_via: sharedWings.sort(),
        })
        if (depth + 1 < maxHops) {
          frontier.push([room, depth + 1])
        }
      }
    }
  }

  results.sort((a, b) => a.hop - b.hop || b.count - a.count)
  return results.slice(0, 50)
}

export function findTunnels(wingA?: string, wingB?: string, store?: DrawerStore): any[] {
  if (!store) return []
  const { nodes } = buildGraph(store)

  const tunnels: any[] = []
  for (const [room, data] of Object.entries(nodes)) {
    if (data.wings.length < 2) continue
    if (wingA && !data.wings.includes(wingA)) continue
    if (wingB && !data.wings.includes(wingB)) continue

    tunnels.push({
      room,
      wings: data.wings,
      halls: data.halls,
      count: data.count,
      recent: data.dates.length > 0 ? data.dates[data.dates.length - 1] : '',
    })
  }

  tunnels.sort((a, b) => b.count - a.count)
  return tunnels.slice(0, 50)
}

export function graphStats(store: DrawerStore): Record<string, any> {
  const { nodes, edges } = buildGraph(store)

  const tunnelRooms = Object.values(nodes).filter(n => n.wings.length >= 2).length
  const wingCounts: Record<string, number> = {}
  for (const data of Object.values(nodes)) {
    for (const w of data.wings) {
      wingCounts[w] = (wingCounts[w] || 0) + 1
    }
  }

  // Sort wing counts descending
  const sortedWingCounts = Object.fromEntries(
    Object.entries(wingCounts).sort((a, b) => b[1] - a[1])
  )

  const topTunnels = Object.entries(nodes)
    .filter(([, d]) => d.wings.length >= 2)
    .sort((a, b) => b[1].wings.length - a[1].wings.length)
    .slice(0, 10)
    .map(([r, d]) => ({ room: r, wings: d.wings, count: d.count }))

  return {
    total_rooms: Object.keys(nodes).length,
    tunnel_rooms: tunnelRooms,
    total_edges: edges.length,
    rooms_per_wing: sortedWingCounts,
    top_tunnels: topTunnels,
  }
}
