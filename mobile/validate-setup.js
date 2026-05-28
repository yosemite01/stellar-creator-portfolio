#!/usr/bin/env node

/**
 * Validation script to check if the mobile app setup is correct
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Stellar Creator Portfolio Mobile Setup...\n');

let errors = 0;
let warnings = 0;

// Check if required files exist
const requiredFiles = [
  'package.json',
  'app.json',
  'App.tsx',
  'babel.config.js',
  'tsconfig.json',
  'src/types/preferences.ts',
  'src/services/PreferencesService.ts',
  'src/hooks/usePreferences.ts',
  'src/screens/PreferencesScreen.tsx',
  'src/components/PreferenceToggle.tsx',
  'src/components/PreferenceSelect.tsx',
  'src/components/PreferenceSlider.tsx',
  'src/components/PreferenceSection.tsx',
];

console.log('📁 Checking required files...');
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    errors++;
  }
});

// Check package.json
console.log('\n📦 Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  
  // Check main entry point
  if (packageJson.main === 'node_modules/expo/AppEntry.js') {
    console.log('  ✅ Correct entry point');
  } else {
    console.log(`  ❌ Wrong entry point: ${packageJson.main}`);
    errors++;
  }
  
  // Check required dependencies
  const requiredDeps = [
    'expo',
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    '@react-native-community/slider',
    'react-native-safe-area-context',
  ];
  
  requiredDeps.forEach(dep => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`  ✅ ${dep}`);
    } else {
      console.log(`  ❌ ${dep} - MISSING`);
      errors++;
    }
  });
  
  // Check for babel-preset-expo
  if (packageJson.devDependencies && packageJson.devDependencies['babel-preset-expo']) {
    console.log('  ✅ babel-preset-expo');
  } else {
    console.log('  ⚠️  babel-preset-expo missing in devDependencies');
    warnings++;
  }
  
} catch (error) {
  console.log(`  ❌ Error reading package.json: ${error.message}`);
  errors++;
}

// Check app.json
console.log('\n⚙️  Checking app.json...');
try {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'app.json'), 'utf8'));
  
  if (appJson.expo && appJson.expo.name) {
    console.log(`  ✅ App name: ${appJson.expo.name}`);
  } else {
    console.log('  ❌ Missing app name');
    errors++;
  }
  
  // Check for expo-router plugin (should not be there)
  if (appJson.expo && appJson.expo.plugins && appJson.expo.plugins.includes('expo-router')) {
    console.log('  ⚠️  expo-router plugin found but not needed');
    warnings++;
  }
  
} catch (error) {
  console.log(`  ❌ Error reading app.json: ${error.message}`);
  errors++;
}

// Check TypeScript files for syntax
console.log('\n📝 Checking TypeScript files...');
const tsFiles = [
  'src/types/preferences.ts',
  'src/services/PreferencesService.ts',
  'src/hooks/usePreferences.ts',
];

tsFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for common issues
    if (content.includes('import') && !content.includes('export')) {
      console.log(`  ⚠️  ${file} - Has imports but no exports`);
      warnings++;
    } else {
      console.log(`  ✅ ${file}`);
    }
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 Validation Summary:');
console.log('='.repeat(50));

if (errors === 0 && warnings === 0) {
  console.log('✅ All checks passed! Setup is correct.');
  console.log('\n🚀 You can now run:');
  console.log('   npm install');
  console.log('   npm start');
  process.exit(0);
} else {
  if (errors > 0) {
    console.log(`❌ ${errors} error(s) found`);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} warning(s) found`);
  }
  console.log('\n🔧 Please fix the issues above before running the app.');
  process.exit(errors > 0 ? 1 : 0);
}
