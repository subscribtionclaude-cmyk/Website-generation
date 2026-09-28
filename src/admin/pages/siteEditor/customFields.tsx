import type { CustomFieldProps } from '../../ui/SchemaForm';
import { MediaField, ProductPicker, RouteField } from './EditorFields';

/** Custom controls shared by every schema-driven editor in the Site Editor (SchemaForm `custom`). */
export function editorCustomFields(key: string, field: CustomFieldProps) {
  if (key === 'section.source.productIds') return <ProductPicker {...field} />;
  if (key === 'section.images.url' || key === 'brand.logo.src' || key.endsWith('.ogImage'))
    return <MediaField {...field} />;
  if (key.endsWith('.href')) return <RouteField {...field} />;
  return undefined;
}
