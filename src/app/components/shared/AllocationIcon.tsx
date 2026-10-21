import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import Emojilib from 'emojilib';
import {
  Home, Shield, Target, Wallet, Car, Plane, GraduationCap, Pill, Utensils, Coffee,
  Shirt, Gamepad2, Music, BookOpen, Dumbbell, Sparkles, PawPrint, Sprout, Wrench, Lightbulb,
  Gift, Smartphone, Monitor, Umbrella, HeartPulse, Landmark, ShoppingCart, Palette, Drama, CircleDot,
  Baby, Bus, Fuel, Wifi, Phone, Scissors, Stethoscope, Building2, PiggyBank, TrendingUp,
  CreditCard, HandHeart, HeartHandshake, Church, Tv, Bike, Train, Ship, Briefcase, ShoppingBag,
  type LucideIcon,
} from 'lucide-react';

// Quick picks shown before the user types anything — the emoji most likely to
// be relevant to a budget category, each tagged in Spanish and English so
// "casa"/"house" or "generosidad"/"giving" surfaces it immediately. The FULL
// search (see EmojiSearchIndex below) isn't limited to this list — it covers
// every emoji in `emojilib`, so "basketball", "restaurant", or anything else
// a life plan or category might need also works, not just finance terms.
const EMOJI_QUICK_PICKS: { emoji: string; tags: string[] }[] = [
  // Vivienda / hogar
  { emoji: '🏠', tags: ['casa', 'hogar', 'vivienda', 'house', 'home'] },
  { emoji: '🏡', tags: ['casa', 'hogar', 'jardín', 'house', 'home', 'garden'] },
  { emoji: '🏢', tags: ['edificio', 'oficina', 'building', 'office'] },
  { emoji: '🏬', tags: ['centro comercial', 'mall', 'store'] },
  { emoji: '🔑', tags: ['llave', 'alquiler', 'key', 'rent'] },
  { emoji: '🛋️', tags: ['muebles', 'sofá', 'furniture', 'sofa'] },
  { emoji: '🛏️', tags: ['cama', 'dormitorio', 'bed', 'bedroom'] },
  { emoji: '🚪', tags: ['puerta', 'door'] },
  { emoji: '🪴', tags: ['planta', 'jardín', 'plant', 'garden'] },
  { emoji: '🧹', tags: ['limpieza', 'cleaning'] },
  { emoji: '🧺', tags: ['lavandería', 'laundry'] },
  { emoji: '🔧', tags: ['reparación', 'mantenimiento', 'repair', 'tools', 'maintenance'] },
  { emoji: '🛡️', tags: ['seguro', 'protección', 'insurance', 'shield'] },
  { emoji: '💡', tags: ['luz', 'electricidad', 'servicios', 'light', 'utilities', 'electricity'] },
  { emoji: '🔥', tags: ['gas', 'calefacción', 'heating'] },
  { emoji: '🚰', tags: ['agua', 'water'] },
  { emoji: '📶', tags: ['internet', 'wifi'] },
  { emoji: '📡', tags: ['internet', 'wifi', 'router'] },

  // Transporte
  { emoji: '🚗', tags: ['coche', 'auto', 'car'] },
  { emoji: '🚙', tags: ['coche', 'suv', 'car'] },
  { emoji: '🏍️', tags: ['moto', 'motorbike', 'motorcycle'] },
  { emoji: '🚲', tags: ['bici', 'bicicleta', 'bike', 'bicycle'] },
  { emoji: '🚌', tags: ['bus', 'transporte público', 'public transport'] },
  { emoji: '🚆', tags: ['tren', 'train'] },
  { emoji: '🚇', tags: ['metro', 'subway'] },
  { emoji: '🚕', tags: ['taxi'] },
  { emoji: '⛽', tags: ['gasolina', 'combustible', 'fuel', 'gas'] },
  { emoji: '🅿️', tags: ['parking', 'aparcamiento'] },
  { emoji: '✈️', tags: ['vuelo', 'avión', 'viaje', 'flight', 'plane', 'travel'] },
  { emoji: '🛳️', tags: ['barco', 'crucero', 'ship', 'cruise'] },

  // Comida
  { emoji: '🍔', tags: ['comida rápida', 'hamburguesa', 'fast food', 'burger'] },
  { emoji: '🍕', tags: ['pizza'] },
  { emoji: '🍜', tags: ['comida', 'restaurante', 'food', 'noodles'] },
  { emoji: '🍱', tags: ['comida', 'almuerzo', 'lunch', 'food'] },
  { emoji: '🛒', tags: ['supermercado', 'compra', 'groceries', 'supermarket'] },
  { emoji: '🥑', tags: ['comida', 'saludable', 'healthy', 'groceries'] },
  { emoji: '☕', tags: ['café', 'coffee'] },
  { emoji: '🍻', tags: ['bar', 'cerveza', 'beer', 'drinks'] },
  { emoji: '🍰', tags: ['postre', 'antojo', 'dessert', 'treat'] },

  // Ropa / cuidado personal
  { emoji: '👕', tags: ['ropa', 'clothes', 'clothing'] },
  { emoji: '👗', tags: ['ropa', 'vestido', 'clothes', 'dress'] },
  { emoji: '👟', tags: ['zapatos', 'shoes'] },
  { emoji: '💄', tags: ['belleza', 'cosmética', 'beauty', 'makeup'] },
  { emoji: '💇', tags: ['peluquería', 'haircut', 'salon'] },
  { emoji: '🧴', tags: ['higiene', 'cuidado personal', 'toiletries'] },

  // Salud
  { emoji: '💊', tags: ['medicina', 'salud', 'medicine', 'health', 'pharmacy'] },
  { emoji: '🏥', tags: ['hospital', 'salud', 'health'] },
  { emoji: '🩺', tags: ['médico', 'doctor', 'health'] },
  { emoji: '🦷', tags: ['dentista', 'dentist'] },
  { emoji: '🏋️', tags: ['gimnasio', 'ejercicio', 'gym', 'fitness'] },
  { emoji: '🧘', tags: ['bienestar', 'yoga', 'wellness'] },
  { emoji: '⚽', tags: ['deporte', 'sport'] },

  // Ocio / entretenimiento
  { emoji: '🎮', tags: ['videojuegos', 'ocio', 'games', 'gaming'] },
  { emoji: '🎵', tags: ['música', 'music'] },
  { emoji: '🎬', tags: ['cine', 'película', 'movies', 'cinema'] },
  { emoji: '📺', tags: ['tv', 'streaming', 'television'] },
  { emoji: '📚', tags: ['libros', 'educación', 'books', 'education'] },
  { emoji: '🎨', tags: ['arte', 'hobby', 'art'] },
  { emoji: '🎭', tags: ['teatro', 'ocio', 'theater'] },
  { emoji: '🎉', tags: ['fiesta', 'celebración', 'party', 'celebration'] },
  { emoji: '🎁', tags: ['regalo', 'gift'] },
  { emoji: '🏖️', tags: ['playa', 'vacaciones', 'beach', 'vacation'] },
  { emoji: '⛰️', tags: ['montaña', 'excursión', 'mountain', 'hiking'] },
  { emoji: '📸', tags: ['fotografía', 'photography'] },

  // Familia / mascotas
  { emoji: '👶', tags: ['bebé', 'niños', 'baby', 'kids'] },
  { emoji: '🧸', tags: ['niños', 'juguetes', 'kids', 'toys'] },
  { emoji: '🎓', tags: ['educación', 'colegio', 'universidad', 'education', 'school', 'college'] },
  { emoji: '🐾', tags: ['mascota', 'pet'] },
  { emoji: '🐶', tags: ['perro', 'mascota', 'dog', 'pet'] },
  { emoji: '🐱', tags: ['gato', 'mascota', 'cat', 'pet'] },
  { emoji: '🌱', tags: ['plantas', 'jardín', 'plants', 'garden'] },

  // Tecnología
  { emoji: '📱', tags: ['móvil', 'teléfono', 'phone', 'mobile'] },
  { emoji: '🖥️', tags: ['ordenador', 'computer', 'pc'] },
  { emoji: '💻', tags: ['portátil', 'laptop'] },
  { emoji: '🎧', tags: ['auriculares', 'headphones'] },

  // Finanzas / trabajo / generosidad
  { emoji: '💰', tags: ['dinero', 'ahorro', 'money', 'savings'] },
  { emoji: '💵', tags: ['dinero', 'efectivo', 'money', 'cash'] },
  { emoji: '💳', tags: ['tarjeta', 'crédito', 'card', 'credit'] },
  { emoji: '🏦', tags: ['banco', 'bank'] },
  { emoji: '📈', tags: ['inversión', 'crecimiento', 'investment', 'growth'] },
  { emoji: '📉', tags: ['gasto', 'pérdida', 'expense', 'loss'] },
  { emoji: '🎯', tags: ['meta', 'objetivo', 'goal', 'target'] },
  { emoji: '💼', tags: ['trabajo', 'negocio', 'work', 'business'] },
  { emoji: '🧾', tags: ['factura', 'recibo', 'bill', 'receipt'] },
  { emoji: '❤️', tags: ['generosidad', 'donación', 'generosity', 'giving'] },
  { emoji: '🤍', tags: ['generosidad', 'ofrenda', 'generosity', 'giving'] },
  { emoji: '🙏', tags: ['generosidad', 'ofrenda', 'iglesia', 'generosity', 'giving', 'church'] },
  { emoji: '🎗️', tags: ['causa', 'donación', 'charity', 'donation'] },
];

// The legacy plain-string list (same emoji, no keywords) — kept for anything
// that still imports it directly.
export const ALLOCATION_ICONS = EMOJI_QUICK_PICKS.map(o => o.emoji);

// Full search index: every emoji `emojilib` knows about (~1,900), each with
// its English keywords — plus, for the quick-pick emoji above, the Spanish
// tags merged in too, so "restaurante" and "restaurant" both work for 🍽️.
// This is what makes an arbitrary search ("basketball", "unicorn", "guitar")
// find something instead of being limited to a hand-picked finance list.
const spanishTagsByEmoji = new Map(EMOJI_QUICK_PICKS.map(o => [o.emoji, o.tags]));
const EMOJI_SEARCH_INDEX: { emoji: string; tags: string[] }[] = Object.entries(Emojilib).map(([emoji, keywords]) => ({
  emoji,
  tags: [...keywords, ...(spanishTagsByEmoji.get(emoji) ?? [])],
}));

// A curated set of lucide-react icons relevant to budget categories — not the
// full ~1500-icon library, to keep the picker scannable. lucide-react is
// already a project dependency (used everywhere else in the app UI), so this
// adds zero new dependencies while giving far more range than a fixed emoji
// grid alone.
const LUCIDE_ICON_OPTIONS: { key: string; Icon: LucideIcon }[] = [
  { key: 'home', Icon: Home }, { key: 'building', Icon: Building2 }, { key: 'shield', Icon: Shield },
  { key: 'target', Icon: Target }, { key: 'wallet', Icon: Wallet }, { key: 'car', Icon: Car },
  { key: 'fuel', Icon: Fuel }, { key: 'bus', Icon: Bus }, { key: 'train', Icon: Train },
  { key: 'plane', Icon: Plane }, { key: 'ship', Icon: Ship }, { key: 'bike', Icon: Bike },
  { key: 'graduation-cap', Icon: GraduationCap }, { key: 'pill', Icon: Pill }, { key: 'stethoscope', Icon: Stethoscope },
  { key: 'heart-pulse', Icon: HeartPulse }, { key: 'utensils', Icon: Utensils }, { key: 'coffee', Icon: Coffee },
  { key: 'shopping-cart', Icon: ShoppingCart }, { key: 'shopping-bag', Icon: ShoppingBag }, { key: 'shirt', Icon: Shirt },
  { key: 'gamepad', Icon: Gamepad2 }, { key: 'music', Icon: Music }, { key: 'tv', Icon: Tv },
  { key: 'book', Icon: BookOpen }, { key: 'dumbbell', Icon: Dumbbell }, { key: 'sparkles', Icon: Sparkles },
  { key: 'paw-print', Icon: PawPrint }, { key: 'sprout', Icon: Sprout }, { key: 'wrench', Icon: Wrench },
  { key: 'lightbulb', Icon: Lightbulb }, { key: 'gift', Icon: Gift }, { key: 'smartphone', Icon: Smartphone },
  { key: 'phone', Icon: Phone }, { key: 'wifi', Icon: Wifi }, { key: 'monitor', Icon: Monitor },
  { key: 'umbrella', Icon: Umbrella }, { key: 'landmark', Icon: Landmark }, { key: 'palette', Icon: Palette },
  { key: 'drama', Icon: Drama }, { key: 'circle-dot', Icon: CircleDot }, { key: 'baby', Icon: Baby },
  { key: 'scissors', Icon: Scissors }, { key: 'piggy-bank', Icon: PiggyBank }, { key: 'trending-up', Icon: TrendingUp },
  { key: 'credit-card', Icon: CreditCard }, { key: 'hand-heart', Icon: HandHeart }, { key: 'heart-handshake', Icon: HeartHandshake },
  { key: 'church', Icon: Church }, { key: 'briefcase', Icon: Briefcase },
];

const LUCIDE_PREFIX = 'lucide:';
const iconByKey = new Map(LUCIDE_ICON_OPTIONS.map(o => [o.key, o.Icon]));

/** Renders whatever is stored in Allocation.icon — a raw emoji, or a
 * "lucide:<key>" reference into the curated set above. Falls back to a plain
 * wallet glyph if the key is unknown (e.g. the curated set changes later). */
export function renderAllocationIcon(icon: string, className = 'text-lg') {
  if (icon.startsWith(LUCIDE_PREFIX)) {
    const Icon = iconByKey.get(icon.slice(LUCIDE_PREFIX.length)) ?? Wallet;
    return <Icon className={className} />;
  }
  return <span className={className}>{icon}</span>;
}

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

const EMOJI_RESULTS_CAP = 100;

/** Shared icon picker for Allocation rows: an emoji tab with quick picks plus
 * free-text search over every emoji `emojilib` knows (~1,900, "basketball",
 * "restaurant", anything a category or life plan might need — not just a
 * finance-tagged shortlist), and an icons tab searching a curated
 * lucide-react set. */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'emoji' | 'icons'>(value.startsWith(LUCIDE_PREFIX) ? 'icons' : 'emoji');
  const [emojiQuery, setEmojiQuery] = useState('');
  const [iconQuery, setIconQuery] = useState('');

  const filteredEmoji = useMemo(() => {
    const q = emojiQuery.trim().toLowerCase();
    if (!q) return EMOJI_QUICK_PICKS;
    const matches: { emoji: string; tags: string[] }[] = [];
    for (const entry of EMOJI_SEARCH_INDEX) {
      if (entry.tags.some(tag => tag.includes(q))) {
        matches.push(entry);
        if (matches.length >= EMOJI_RESULTS_CAP) break;
      }
    }
    return matches;
  }, [emojiQuery]);

  const filteredIcons = iconQuery.trim()
    ? LUCIDE_ICON_OPTIONS.filter(o => o.key.includes(iconQuery.trim().toLowerCase()))
    : LUCIDE_ICON_OPTIONS;

  return (
    <div>
      <div className="flex gap-1 mb-2 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('emoji')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${tab === 'emoji' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          {t('allocation.iconTabEmoji')}
        </button>
        <button
          type="button"
          onClick={() => setTab('icons')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${tab === 'icons' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          {t('allocation.iconTabIcons')}
        </button>
      </div>

      {tab === 'emoji' ? (
        <div>
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={emojiQuery}
              onChange={e => setEmojiQuery(e.target.value)}
              placeholder={t('allocation.iconSearchPlaceholder')}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-10 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {filteredEmoji.map(({ emoji, tags }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onChange(emoji)}
                title={tags[0]}
                className={`w-9 h-9 text-lg rounded-lg flex items-center justify-center transition-all ${value === emoji ? 'bg-primary/10 ring-2 ring-primary scale-110' : 'hover:bg-muted'}`}
              >
                {emoji}
              </button>
            ))}
            {filteredEmoji.length === 0 && (
              <p className="col-span-10 text-xs text-muted-foreground text-center py-3">{t('allocation.iconSearchEmpty')}</p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={iconQuery}
              onChange={e => setIconQuery(e.target.value)}
              placeholder={t('allocation.iconSearchPlaceholder')}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-10 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {filteredIcons.map(({ key, Icon }) => {
              const iconValue = `${LUCIDE_PREFIX}${key}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChange(iconValue)}
                  title={key}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${value === iconValue ? 'bg-primary/10 ring-2 ring-primary scale-110' : 'hover:bg-muted'}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
            {filteredIcons.length === 0 && (
              <p className="col-span-10 text-xs text-muted-foreground text-center py-3">{t('allocation.iconSearchEmpty')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
