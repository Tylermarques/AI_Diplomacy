import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PowerENUM } from '../../../src/types/map';
import { UnitTypeENUM } from '../../../src/types/units';

/**
 * Test suite for unit creation
 * 
 * These tests verify that unit types and power enums are correctly defined.
 */

describe('Unit Creation', () => {
  it('should have all required power types defined', () => {
    // Check that all 7 major powers are defined
    expect(PowerENUM.ENGLAND).toBeDefined();
    expect(PowerENUM.FRANCE).toBeDefined();
    expect(PowerENUM.GERMANY).toBeDefined();
    expect(PowerENUM.ITALY).toBeDefined();
    expect(PowerENUM.AUSTRIA).toBeDefined();
    expect(PowerENUM.RUSSIA).toBeDefined();
    expect(PowerENUM.TURKEY).toBeDefined();
    
    // Check total number of powers
    expect(Object.keys(PowerENUM).length).toBe(7);
  });

  it('should have all required unit types defined', () => {
    // Check that Army and Fleet unit types are defined
    expect(UnitTypeENUM.A).toBeDefined();
    expect(UnitTypeENUM.F).toBeDefined();
    
    // Check total number of unit types
    expect(Object.keys(UnitTypeENUM).length).toBe(2);
  });

  it('should have distinct values for each power', () => {
    // Create a set of all power values
    const powerValues = new Set(Object.values(PowerENUM));
    
    // Check that all values are unique
    expect(powerValues.size).toBe(Object.keys(PowerENUM).length);
  });

  it('should have distinct values for each unit type', () => {
    // Create a set of all unit type values
    const unitTypeValues = new Set(Object.values(UnitTypeENUM));
    
    // Check that all values are unique
    expect(unitTypeValues.size).toBe(Object.keys(UnitTypeENUM).length);
  });
});