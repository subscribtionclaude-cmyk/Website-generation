/** Side-effect module: importing it registers the service dictionaries with the translator. */
import { registerMessages } from '../extraMessages';
import { servicesAr } from './services.ar';
import { servicesEn } from './services.en';

registerMessages({ ar: servicesAr, en: servicesEn });
