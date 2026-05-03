export const FIRST_NAMES: string[] = [
  'Mochi', 'Boba', 'Taco', 'Mango', 'Chip', 'Dot', 'Sage', 'Clover',
  'Maple', 'Olive', 'Bean', 'Pip', 'Jinx', 'Loki', 'Ember', 'Moss',
  'Fern', 'Dusk', 'Bolt', 'Ash', 'Kit', 'Juno', 'Echo', 'Nova',
  'Luna', 'Pixel', 'Byte', 'Drift', 'Blip', 'Snap', 'Wren', 'Finn',
  'Rue', 'Sky', 'Zed', 'Coco', 'Tofu', 'Chai', 'Basil', 'Ginger',
  'Sprout', 'Puck', 'Wisp', 'Spark', 'Bloom', 'Frost', 'Miso', 'Latte',
  'Peach', 'Plum', 'Fig', 'Kiwi', 'Lime', 'Mint', 'Coral', 'Sunny',
  'Misty', 'Breeze', 'Scoot', 'Bumble', 'Gizmo', 'Turbo', 'Cosmo', 'Dash',
]

export const LAST_NAMES: string[] = [
  'Pickle', 'Waffle', 'Noodle', 'Biscuit', 'Pretzel', 'Cookie', 'Muffin', 'Donut',
  'Nacho', 'Pancake', 'Nugget', 'Crumble', 'Pudding', 'Truffle', 'Cupcake', 'Brownie',
  'Pebble', 'Ripple', 'Cobble', 'Fidget', 'Doodle', 'Wobble', 'Tumble', 'Nibble',
  'Sparkle', 'Twinkle', 'Bramble', 'Shuffle', 'Whisker', 'Pumpkin', 'Acorn', 'Walnut',
  'Pepper', 'Cheddar', 'Baguette', 'Dumpling', 'Toffee', 'Caramel', 'Wonton', 'Crouton',
  'Peanut', 'Cashew', 'Almond', 'Pistachio', 'Hazelnut', 'Coconut', 'Chestnut', 'Brioche',
  'Poppy', 'Clover', 'Thistle', 'Willow', 'Meadow', 'Cricket', 'Falcon', 'Sparrow',
  'Otter', 'Badger', 'Ferret', 'Penguin', 'Gecko', 'Puffin', 'Bunny', 'Hedgehog',
]

export function randomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${first} ${last}`
}
