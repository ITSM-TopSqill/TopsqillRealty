/** Indicative pincodes per locality. Verify before going live. */
export const PINCODES: Record<string, string[]> = {
  "Golf Course Road": ["122002", "122011"], "Sector 65": ["122102", "122101"], "Dwarka Expressway": ["122004", "122006"],
  "Sohna Road": ["122018"], "DLF Phase 5": ["122009"], "Sector 82": ["122004"], "Golf Course Extension": ["122102"], "Sector 57": ["122003"],
  "Sector 150": ["201310"], "Sector 75": ["201301"], "Sector 137": ["201305"], "Sector 128": ["201304"], "Sector 18": ["201301"], "Sector 107": ["201304"],
  "Sector Mu": ["201310"], "Pari Chowk": ["201310"], "Knowledge Park": ["201310"],
  Dwarka: ["110075", "110077", "110078"], "Vasant Kunj": ["110070"], Saket: ["110017"], Rohini: ["110085"], "Greater Kailash": ["110048"],
  Powai: ["400076"], "Andheri West": ["400053"], "Bandra West": ["400050"], "Thane West": ["400601"], "Goregaon East": ["400063"], Chembur: ["400071"],
  Whitefield: ["560066"], "Sarjapur Road": ["560035"], "HSR Layout": ["560102"], Hebbal: ["560024"], "Electronic City": ["560100"], Koramangala: ["560034"],
  Hinjewadi: ["411057"], Baner: ["411045"], Kharadi: ["411014"], Wakad: ["411057"], "Viman Nagar": ["411014"],
  Gachibowli: ["500032"], Kondapur: ["500084"], Kokapet: ["500075"], Madhapur: ["500081"],
};
/** Premium pincodes that feed buyers into a city's luxury market. */
export const HNI_FEEDERS: Record<string, [string, string][]> = {
  Gurgaon: [["122002", "DLF Phases 1 to 3"], ["110017", "Saket, South Delhi"]],
  Noida: [["201301", "Central Noida"], ["110092", "East Delhi"]],
  "Greater Noida": [["201301", "Central Noida"]],
  Delhi: [["110003", "Lodhi Road"], ["110049", "South Extension"], ["110021", "Chanakyapuri"]],
  Mumbai: [["400006", "Malabar Hill"], ["400050", "Bandra West"], ["400049", "Juhu"]],
  Bengaluru: [["560038", "Indiranagar"], ["560034", "Koramangala"]],
  Pune: [["411007", "Aundh"], ["411045", "Baner"]],
  Hyderabad: [["500033", "Jubilee Hills"], ["500034", "Banjara Hills"]],
};
/** Localities arrive with different capitalisation ("Sector MU" vs "Sector Mu"), so match loosely. */
const BY_KEY = new Map(Object.entries(PINCODES).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, " ").trim(), v]));
export const pincodesFor = (locality: string): string[] =>
  BY_KEY.get(String(locality ?? "").toLowerCase().replace(/\s+/g, " ").trim()) ?? [];
