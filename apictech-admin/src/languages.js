// Languages offered in the Keeper and Admin apps. English is the source language; the others
// are dictionaries of the everyday screen text (see lang/*.js). Text with no translation stays in English.
export const LANGUAGES = [
  { code: 'en', native: 'English', dir: 'ltr' },
  { code: 'hi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'ta', native: 'தமிழ்', dir: 'ltr' },
  { code: 'te', native: 'తెలుగు', dir: 'ltr' },
  { code: 'kn', native: 'ಕನ್ನಡ', dir: 'ltr' },
  { code: 'ml', native: 'മലയാളം', dir: 'ltr' },
  { code: 'mr', native: 'मराठी', dir: 'ltr' },
  { code: 'bn', native: 'বাংলা', dir: 'ltr' },
  { code: 'gu', native: 'ગુજરાતી', dir: 'ltr' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', dir: 'ltr' },
  { code: 'or', native: 'ଓଡ଼ିଆ', dir: 'ltr' },
  { code: 'ur', native: 'اردو', dir: 'rtl' },
]

export const isLanguage = (code) => LANGUAGES.some((item) => item.code === code)
