export interface RateRecord {
  id: string;
  pricePerKwh: number;
  tariffType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
