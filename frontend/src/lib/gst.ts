// GST state codes offered in billing forms (the place of supply decides CGST + SGST vs IGST).
export const GST_STATES: Record<string, string> = { '24': 'Gujarat', '27': 'Maharashtra', '08': 'Rajasthan', '07': 'Delhi', '29': 'Karnataka', '36': 'Telangana' };

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
