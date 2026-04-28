import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateEncryptionKey, validateEnvironment, logEnvironmentConfig } from './env-validation'

describe('env-validation', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('validateEncryptionKey', () => {
    it('should accept valid 64-character hex string', () => {
      const validKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
      expect(validateEncryptionKey(validKey)).toBe(true)
    })

    it('should accept uppercase hex characters', () => {
      const validKey = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2'
      expect(validateEncryptionKey(validKey)).toBe(true)
    })

    it('should accept mixed case hex characters', () => {
      const validKey = 'A1b2C3d4E5f6A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9f0A1b2'
      expect(validateEncryptionKey(validKey)).toBe(true)
    })

    it('should reject all-zero key', () => {
      const allZerosKey = '0000000000000000000000000000000000000000000000000000000000000000'
      expect(validateEncryptionKey(allZerosKey)).toBe(false)
    })

    it('should reject key that is too short', () => {
      const shortKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0'
      expect(validateEncryptionKey(shortKey)).toBe(false)
    })

    it('should reject key that is too long', () => {
      const longKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1a1a1'
      expect(validateEncryptionKey(longKey)).toBe(false)
    })

    it('should reject key with invalid hex characters', () => {
      const invalidKey = 'g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1'
      expect(validateEncryptionKey(invalidKey)).toBe(false)
    })

    it('should reject key with spaces', () => {
      const keyWithSpaces = 'a1b2c3d4 e5f6a7b8 c9d0e1f2 a3b4c5d6 e7f8a9b0 c1d2e3f4 a5b6c7d8 e9f0a1'
      expect(validateEncryptionKey(keyWithSpaces)).toBe(false)
    })

    it('should reject empty string', () => {
      expect(validateEncryptionKey('')).toBe(false)
    })
  })

  describe('validateEnvironment', () => {
    it('should not throw when ENCRYPTION_KEY is not set', () => {
      delete process.env.ENCRYPTION_KEY
      expect(() => validateEnvironment()).not.toThrow()
    })

    it('should not throw when ENCRYPTION_KEY is valid', () => {
      process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
      expect(() => validateEnvironment()).not.toThrow()
    })

    it('should throw when ENCRYPTION_KEY is all zeros', () => {
      process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000'
      expect(() => validateEnvironment()).toThrow()
      expect(() => validateEnvironment()).toThrow(/Invalid ENCRYPTION_KEY/)
    })

    it('should throw when ENCRYPTION_KEY is invalid format', () => {
      process.env.ENCRYPTION_KEY = 'invalid-key'
      expect(() => validateEnvironment()).toThrow()
      expect(() => validateEnvironment()).toThrow(/Invalid ENCRYPTION_KEY/)
    })

    it('should include helpful error message with generation command', () => {
      process.env.ENCRYPTION_KEY = 'invalid'
      try {
        validateEnvironment()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(String(error)).toContain('openssl rand -hex 32')
      }
    })
  })

  describe('logEnvironmentConfig', () => {
    it('should log when ENCRYPTION_KEY is valid', () => {
      const consoleSpy = vi.spyOn(console, 'log')
      process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'

      logEnvironmentConfig()

      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('ENCRYPTION_KEY: [VALID')
      consoleSpy.mockRestore()
    })

    it('should warn when ENCRYPTION_KEY is invalid', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn')
      process.env.ENCRYPTION_KEY = 'invalid'

      logEnvironmentConfig()

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY: [INVALID'))
      consoleWarnSpy.mockRestore()
    })

    it('should log when ENCRYPTION_KEY is not set', () => {
      const consoleSpy = vi.spyOn(console, 'log')
      delete process.env.ENCRYPTION_KEY

      logEnvironmentConfig()

      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('ENCRYPTION_KEY: [NOT SET]')
      consoleSpy.mockRestore()
    })

    it('should sanitize DATABASE_URL password', () => {
      const consoleSpy = vi.spyOn(console, 'log')
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/db'

      logEnvironmentConfig()

      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('****')
      expect(calls).not.toContain('password')
      consoleSpy.mockRestore()
    })

    it('should handle invalid DATABASE_URL gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'log')
      process.env.DATABASE_URL = 'not-a-valid-url'

      logEnvironmentConfig()

      const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
      expect(calls).toContain('[INVALID URL]')
      consoleSpy.mockRestore()
    })
  })
})
