import { resolveLocalized, type LocalizedText } from '@/domain/localized';

/** Egypt's 27 governorates (delivery is available broadly; the fee is confirmed manually by staff). */
export const GOVERNORATES: { key: string; name: LocalizedText }[] = [
  { key: 'cairo', name: { ar: 'القاهرة', en: 'Cairo' } },
  { key: 'giza', name: { ar: 'الجيزة', en: 'Giza' } },
  { key: 'alexandria', name: { ar: 'الإسكندرية', en: 'Alexandria' } },
  { key: 'qalyubia', name: { ar: 'القليوبية', en: 'Qalyubia' } },
  { key: 'dakahlia', name: { ar: 'الدقهلية', en: 'Dakahlia' } },
  { key: 'sharqia', name: { ar: 'الشرقية', en: 'Sharqia' } },
  { key: 'gharbia', name: { ar: 'الغربية', en: 'Gharbia' } },
  { key: 'monufia', name: { ar: 'المنوفية', en: 'Monufia' } },
  { key: 'beheira', name: { ar: 'البحيرة', en: 'Beheira' } },
  { key: 'kafr_el_sheikh', name: { ar: 'كفر الشيخ', en: 'Kafr El Sheikh' } },
  { key: 'damietta', name: { ar: 'دمياط', en: 'Damietta' } },
  { key: 'port_said', name: { ar: 'بورسعيد', en: 'Port Said' } },
  { key: 'ismailia', name: { ar: 'الإسماعيلية', en: 'Ismailia' } },
  { key: 'suez', name: { ar: 'السويس', en: 'Suez' } },
  { key: 'faiyum', name: { ar: 'الفيوم', en: 'Faiyum' } },
  { key: 'beni_suef', name: { ar: 'بني سويف', en: 'Beni Suef' } },
  { key: 'minya', name: { ar: 'المنيا', en: 'Minya' } },
  { key: 'asyut', name: { ar: 'أسيوط', en: 'Asyut' } },
  { key: 'sohag', name: { ar: 'سوهاج', en: 'Sohag' } },
  { key: 'qena', name: { ar: 'قنا', en: 'Qena' } },
  { key: 'luxor', name: { ar: 'الأقصر', en: 'Luxor' } },
  { key: 'aswan', name: { ar: 'أسوان', en: 'Aswan' } },
  { key: 'red_sea', name: { ar: 'البحر الأحمر', en: 'Red Sea' } },
  { key: 'new_valley', name: { ar: 'الوادي الجديد', en: 'New Valley' } },
  { key: 'matrouh', name: { ar: 'مطروح', en: 'Matrouh' } },
  { key: 'north_sinai', name: { ar: 'شمال سيناء', en: 'North Sinai' } },
  { key: 'south_sinai', name: { ar: 'جنوب سيناء', en: 'South Sinai' } },
];

export function governorateName(key: string | null): LocalizedText | null {
  return GOVERNORATES.find((g) => g.key === key)?.name ?? (key ? { ar: key } : null);
}

/** "Governorate, area[, address]" with the locale's comma (، in Arabic). */
export function deliveryPlace(
  parts: { governorate: string | null; area: string | null; address?: string | null },
  locale: 'ar' | 'en',
): string {
  const governorate = governorateName(parts.governorate);
  return [governorate ? resolveLocalized(governorate, locale) : null, parts.area, parts.address]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(locale === 'ar' ? '، ' : ', ');
}
