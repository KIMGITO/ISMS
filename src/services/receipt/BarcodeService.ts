/**
 * BarcodeService
 * 
 * Reusable, offline-first service that generates high-resolution, vector-crisp
 * Code 39 machine-readable barcodes.
 */

const CODE39_ALPHABET: Record<string, string> = {
  '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
  '4': '101001100111', '5': '1101001100101', '6': '1011001100101', '7': '101001011011',
  '8': '1101001011011', '9': '101100101101', 'A': '110101001011', 'B': '101101001011',
  'C': '110110100101', 'D': '101011001011', 'E': '110101100101', 'F': '101101100101',
  'G': '101010011011', 'H': '110101001101', 'I': '101101001101', 'J': '101011001101',
  'K': '110101010011', 'L': '101101010011', 'M': '110110101001', 'N': '101011010011',
  'O': '110101101001', 'P': '101101101001', 'Q': '101010110011', 'R': '110101011001',
  'S': '101101011001', 'T': '101011011001', 'U': '110010101011', 'V': '100110101011',
  'W': '110011010101', 'X': '100101101011', 'Y': '110010110101', 'Z': '100110110101',
  '-': '100101011011', '.': '110010101101', ' ': '100110101101', '*': '100101101101',
  '$': '100100100101', '/': '100100101001', '+': '100101001001', '%': '101001001001'
};

export class BarcodeService {
  /**
   * Encodes a string into Code 39 bars sequence and generates a vector SVG string.
   * Standard commercial scanners fully support Code 39 out of the box.
   */
  public static generateCode39Svg(value: string, showText = true): string {
    // Sanitize input: uppercase and keep only supported chars
    let sanitized = value.toUpperCase().trim();
    // Filter unsupported chars
    sanitized = sanitized.split('').filter(char => CODE39_ALPHABET[char] !== undefined).join('');
    
    if (sanitized.length === 0) {
      sanitized = "EMPTY";
    }

    // Add start and stop characters '*' if not present
    const fullText = sanitized.startsWith('*') && sanitized.endsWith('*') 
      ? sanitized 
      : `*${sanitized}*`;

    // Build the binary string
    let binarySequence = "";
    for (let i = 0; i < fullText.length; i++) {
      const char = fullText[i];
      binarySequence += CODE39_ALPHABET[char];
      if (i < fullText.length - 1) {
        binarySequence += "0"; // Inter-character gap
      }
    }

    // SVG parameters
    const barWidth = 1.6;
    const barHeight = 45;
    const padding = 15;
    const totalBarsCount = binarySequence.length;
    const svgWidth = (totalBarsCount * barWidth) + (padding * 2);
    const svgHeight = barHeight + (showText ? 20 : 5);

    let paths = "";
    let currentX = padding;

    for (let i = 0; i < binarySequence.length; i++) {
      if (binarySequence[i] === '1') {
        paths += `M${currentX.toFixed(1)},0 h${barWidth.toFixed(1)} v${barHeight} h-${barWidth.toFixed(1)} Z `;
      }
      currentX += barWidth;
    }

    const textY = barHeight + 14;
    const textElement = showText
      ? `<text x="${(svgWidth / 2).toFixed(1)}" y="${textY}" fill="#0f172a" font-family="monospace" font-size="10" font-weight="bold" text-anchor="middle" letter-spacing="1">${sanitized}</text>`
      : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="auto">
      <rect width="100%" height="100%" fill="#ffffff" rx="4"/>
      <path d="${paths}" fill="#000000"/>
      ${textElement}
    </svg>`;
  }

  /**
   * Helper to verify if barcode value is scan-compatible
   */
  public static validateBarcodeValue(value: string): boolean {
    const uppercase = value.toUpperCase();
    for (let i = 0; i < uppercase.length; i++) {
      if (CODE39_ALPHABET[uppercase[i]] === undefined) {
        return false;
      }
    }
    return true;
  }
}
