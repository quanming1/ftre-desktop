import { describe, it, expect, beforeEach } from 'vitest';
import { VLManager } from './vl-manager';

describe('VLManager', () => {
  let manager: VLManager;

  beforeEach(() => {
    manager = new VLManager({
      len: 100,
      presetHeight: 50,
      bufferSize: 5,
    });
  });

  describe('constructor', () => {
    it('should initialize cache with preset heights', () => {
      expect(manager.cache.length).toBe(100);
      expect(manager.cache.every((h) => h === 50)).toBe(true);
    });
  });

  describe('setCache', () => {
    it('should update cache and return true if same value', () => {
      manager.setCache(0, 50);
      const isSame = manager.setCache(0, 50);
      expect(isSame).toBe(true);
      expect(manager.cache[0]).toBe(50);
    });

    it('should update cache and return false if different value', () => {
      const isSame = manager.setCache(0, 100);
      expect(isSame).toBe(false);
      expect(manager.cache[0]).toBe(100);
    });
  });

  describe('getCache', () => {
    it('should return cached value', () => {
      manager.setCache(5, 120);
      expect(manager.getCache(5)).toBe(120);
    });

    it('should return preset height for uncached index', () => {
      expect(manager.getCache(1000)).toBe(50);
    });
  });

  describe('getTotalHeight', () => {
    it('should return total height of all items', () => {
      expect(manager.getTotalHeight()).toBe(5000); // 100 * 50
    });

    it('should reflect cache updates', () => {
      manager.setCache(0, 100);
      manager.setCache(1, 200);
      expect(manager.getTotalHeight()).toBe(5000 - 50 - 50 + 100 + 200);
    });
  });

  describe('getRenderRange', () => {
    it('should return correct range for top of list', () => {
      const range = manager.getRenderRange({
        offsetOfTop: 0,
        maxRenderHeight: 500,
        len: 100,
      });

      expect(range.topIndex).toBe(0);
      expect(range.topBlank).toBe(0);
      expect(range.bottomIndex).toBeGreaterThan(10);
    });

    it('should return correct range for middle of list', () => {
      const range = manager.getRenderRange({
        offsetOfTop: 2500, // scroll to middle (50 items * 50px)
        maxRenderHeight: 500,
        len: 100,
      });

      expect(range.topIndex).toBeLessThan(50);
      expect(range.bottomIndex).toBeGreaterThan(50);
    });

    it('should return correct range for bottom of list', () => {
      const range = manager.getRenderRange({
        offsetOfTop: 4500, // near bottom
        maxRenderHeight: 500,
        len: 100,
      });

      expect(range.bottomIndex).toBe(100);
      expect(range.bottomBlank).toBe(0);
    });

    it('should include buffer items', () => {
      const range = manager.getRenderRange({
        offsetOfTop: 1000, // 20 items down
        maxRenderHeight: 500, // 10 items visible
        len: 100,
      });

      // Should render buffer items above and below
      expect(range.topIndex).toBeLessThan(20);
      expect(range.bottomIndex).toBeGreaterThan(30);
    });

    it('should handle dynamic heights', () => {
      // Make first 10 items taller
      for (let i = 0; i < 10; i++) {
        manager.setCache(i, 100);
      }

      const range = manager.getRenderRange({
        offsetOfTop: 500,
        maxRenderHeight: 500,
        len: 100,
      });

      // With taller items, fewer should be visible
      expect(range.topIndex).toBeLessThanOrEqual(5);
    });

    it('should handle empty list', () => {
      const emptyManager = new VLManager({
        len: 0,
        presetHeight: 50,
        bufferSize: 5,
      });

      const range = emptyManager.getRenderRange({
        offsetOfTop: 0,
        maxRenderHeight: 500,
        len: 0,
      });

      expect(range.topIndex).toBe(0);
      expect(range.bottomIndex).toBe(0);
    });

    it('should maintain height invariant: topBlank + rendered + bottomBlank = totalHeight', () => {
      const m = new VLManager({ len: 100, presetHeight: 32, bufferSize: 12 });
      const totalHeight = m.getTotalHeight(); // 100 * 32 = 3200

      // Test various scroll positions
      const scrollPositions = [0, 50, 100, 500, 1000, 2000, 2600, 2700, 3000];
      
      for (const scrollTop of scrollPositions) {
        const range = m.getRenderRange({ offsetOfTop: scrollTop, maxRenderHeight: 500, len: 100 });
        
        // Calculate rendered height
        let renderedHeight = 0;
        for (let i = range.topIndex; i < range.bottomIndex; i++) {
          renderedHeight += m.getCache(i);
        }
        
        const sum = range.topBlank + renderedHeight + range.bottomBlank;
        expect(sum).toBe(totalHeight);
      }
    });
  });
});
