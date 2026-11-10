import {
  Apple, Armchair, Baby, Bath, BedDouble, Beef, Bike, Book, BookHeadphones, BookImage, BookOpen, BookOpenText, Boxes, Cable, Camera,
  CarFront, Coffee, Cookie, CookingPot, Croissant, CupSoda, Dices, Drone, Droplet, Droplets, Dumbbell, Fish, FishingRod, Flame,
  Footprints, Gamepad, Gamepad2, Gem, Gift, Glasses, Guitar, Hammer, Handbag, Headphones, HeartPulse, HouseWifi, Image, Lamp, Laptop,
  Luggage, Milk, Monitor, MonitorSmartphone, Mountain, MountainSnow, Newspaper, NotebookPen, Package, PaintRoller, Palette, PawPrint,
  Pen, PerfumeBottle, Pill, PillBottle, PlugZap, Puzzle, Sandwich, Scissors, Shirt, ShoppingBasket, Smartphone, Snowflake,
  SoapDispenserDroplet, Sofa, Sparkles, SportShoe, SprayCan, Sprout, Tablet, Tent, Toothbrush, ToyBrick, Trees, Tv, Umbrella,
  Volleyball, WashingMachine, Watch, Waves, Wheat, Wrench, type LucideIcon,
} from 'lucide-react'
import { pictureKeyOf, type PictureKey } from '../shopTaxonomy'

// The default pictures' icons (THEME.md §3 "Product pictures"). Loaded on its
// own when the Wishlist opens (hooks/useCategoryPictures.ts), so these icons
// and the taxonomy never weigh on the Shop page's first download.

export const ICONS: Record<PictureKey, LucideIcon> = {
  apple: Apple, armchair: Armchair, baby: Baby, bath: Bath, 'bed-double': BedDouble, beef: Beef, bike: Bike, book: Book,
  'book-headphones': BookHeadphones, 'book-image': BookImage, 'book-open': BookOpen, 'book-open-text': BookOpenText, boxes: Boxes,
  cable: Cable, camera: Camera, 'car-front': CarFront, 'cooking-pot': CookingPot, cookie: Cookie, croissant: Croissant,
  'cup-soda': CupSoda, coffee: Coffee, dices: Dices, drone: Drone, droplet: Droplet, droplets: Droplets, dumbbell: Dumbbell, fish: Fish,
  'fishing-rod': FishingRod, flame: Flame, footprints: Footprints, gamepad: Gamepad, 'gamepad-2': Gamepad2, gem: Gem, gift: Gift,
  glasses: Glasses, guitar: Guitar, hammer: Hammer, handbag: Handbag, headphones: Headphones, 'heart-pulse': HeartPulse,
  'house-wifi': HouseWifi, image: Image, lamp: Lamp, laptop: Laptop, luggage: Luggage, milk: Milk, monitor: Monitor,
  'monitor-smartphone': MonitorSmartphone, mountain: Mountain, 'mountain-snow': MountainSnow, newspaper: Newspaper,
  'notebook-pen': NotebookPen, package: Package, 'paint-roller': PaintRoller, palette: Palette, 'paw-print': PawPrint, pen: Pen,
  'perfume-bottle': PerfumeBottle, pill: Pill, 'pill-bottle': PillBottle, 'plug-zap': PlugZap, puzzle: Puzzle, sandwich: Sandwich,
  scissors: Scissors, shirt: Shirt, 'shopping-basket': ShoppingBasket, smartphone: Smartphone, snowflake: Snowflake,
  'soap-dispenser-droplet': SoapDispenserDroplet, sofa: Sofa, sparkles: Sparkles, 'sport-shoe': SportShoe, 'spray-can': SprayCan,
  sprout: Sprout, tablet: Tablet, tent: Tent, toothbrush: Toothbrush, 'toy-brick': ToyBrick, trees: Trees, tv: Tv, umbrella: Umbrella,
  volleyball: Volleyball, 'washing-machine': WashingMachine, watch: Watch, waves: Waves, wheat: Wheat, wrench: Wrench,
}

/** The default picture for a category path (pictureKeyOf), as its icon; null: the initials show. */
export function iconFor(topName: string | null | undefined, subName: string | null | undefined): LucideIcon | null {
  const key = pictureKeyOf(topName, subName)
  return key ? ICONS[key] : null
}
