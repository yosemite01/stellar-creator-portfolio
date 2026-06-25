export type FilterPreset = 'none' | 'sharpen' | 'blur' | 'edge' | 'emboss' | 'sepia' | 'grayscale' | 'vintage';

/** 3×3 convolution kernels for GPU fragment shaders. */
export const CONVOLUTION_KERNELS: Record<Exclude<FilterPreset, 'none'>, { matrix: number[]; divisor: number; offset: number }> = {
  sharpen: {
    matrix: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    divisor: 1,
    offset: 0,
  },
  blur: {
    matrix: [1, 2, 1, 2, 4, 2, 1, 2, 1],
    divisor: 16,
    offset: 0,
  },
  edge: {
    matrix: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    divisor: 1,
    offset: 0,
  },
  emboss: {
    matrix: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
    divisor: 1,
    offset: 128,
  },
  sepia: {
    matrix: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
    divisor: 1,
    offset: 0,
  },
  grayscale: {
    matrix: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
    divisor: 1,
    offset: 0,
  },
  vintage: {
    matrix: [0.272, 0.534, 0.131, 0.349, 0.686, 0.168, 0.393, 0.769, 0.189],
    divisor: 1,
    offset: 20,
  },
};

/** GLSL fragment shader applying a 3×3 convolution matrix on GPU. */
export function buildConvolutionFragmentShader(kernelFlat: number[], divisor: number, offset: number): string {
  const k = kernelFlat.map((v) => v.toFixed(4)).join(', ');
  return `
    precision highp float;
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    uniform vec2 uTexelSize;

    const float kernel[9] = float[9](${k});
    const float divisor = ${divisor.toFixed(4)};
    const float offset = ${offset.toFixed(4)};

    void main() {
      vec4 color = vec4(0.0);
      int idx = 0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y)) * uTexelSize;
          color += texture2D(uTexture, vTexCoord + offset) * kernel[idx];
          idx++;
        }
      }
      gl_FragColor = (color / divisor) + vec4(offset / 255.0);
    }
  `;
}

export const CONVOLUTION_VERTEX_SHADER = `
  attribute vec2 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vTexCoord = aTexCoord;
  }
`;

export function getShaderForPreset(preset: FilterPreset): { vertex: string; fragment: string } | null {
  if (preset === 'none') return null;
  const cfg = CONVOLUTION_KERNELS[preset];
  return {
    vertex: CONVOLUTION_VERTEX_SHADER,
    fragment: buildConvolutionFragmentShader(cfg.matrix, cfg.divisor, cfg.offset),
  };
}

/** CPU fallback: apply 3×3 convolution to RGBA pixel buffer. */
export function applyConvolutionCpu(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  preset: FilterPreset,
): Uint8ClampedArray {
  if (preset === 'none') return pixels;
  const { matrix, divisor, offset } = CONVOLUTION_KERNELS[preset];
  const out = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(width - 1, Math.max(0, x + kx));
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          const i = (sy * width + sx) * 4;
          const w = matrix[ki++];
          r += pixels[i] * w;
          g += pixels[i + 1] * w;
          b += pixels[i + 2] * w;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = clampByte(r / divisor + offset);
      out[o + 1] = clampByte(g / divisor + offset);
      out[o + 2] = clampByte(b / divisor + offset);
      out[o + 3] = pixels[o + 3];
    }
  }
  return out;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
