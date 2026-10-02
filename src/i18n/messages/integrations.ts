/** Side-effect module: importing it registers the Phase 09 storefront dictionaries. */
import { registerMessages } from '../extraMessages';
import { integrationsAr } from './integrations.ar';
import { integrationsEn } from './integrations.en';

registerMessages({ ar: integrationsAr, en: integrationsEn });
