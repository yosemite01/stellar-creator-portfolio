import React, { useState } from 'react';
import { View, Image, StyleSheet, PanResponder, Dimensions, Text } from 'react-native';

interface BeforeAfterSliderProps {
  beforeUri: string;
  afterUri: string;
  width: number;
  height: number;
}

export function BeforeAfterSlider({ beforeUri, afterUri, width, height }: BeforeAfterSliderProps) {
  const screenWidth = Dimensions.get('window').width - 32;
  const aspectRatio = height / width;
  const displayWidth = screenWidth;
  const displayHeight = displayWidth * aspectRatio;

  const [sliderPosition, setSliderPosition] = useState(0.5);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      const newPosition = Math.max(0, Math.min(1, (gestureState.moveX - 16) / displayWidth));
      setSliderPosition(newPosition);
    },
  });

  return (
    <View style={[styles.container, { width: displayWidth, height: displayHeight }]}>
      <Image
        source={{ uri: afterUri }}
        style={[styles.image, { width: displayWidth, height: displayHeight }]}
        resizeMode="cover"
      />
      <View style={[styles.beforeContainer, { width: displayWidth * sliderPosition }]}>
        <Image
          source={{ uri: beforeUri }}
          style={[styles.image, { width: displayWidth, height: displayHeight }]}
          resizeMode="cover"
        />
      </View>
      <View
        style={[styles.sliderLine, { left: displayWidth * sliderPosition }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderHandle}>
          <Text style={styles.sliderArrows}>{'<>'}</Text>
        </View>
      </View>
      <View style={[styles.label, styles.labelLeft]}>
        <Text style={styles.labelText}>Before</Text>
      </View>
      <View style={[styles.label, styles.labelRight]}>
        <Text style={styles.labelText}>After</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  beforeContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    overflow: 'hidden',
  },
  sliderLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#ffffff',
    marginLeft: -1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderHandle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  sliderArrows: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  label: {
    position: 'absolute',
    bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  labelLeft: { left: 8 },
  labelRight: { right: 8 },
  labelText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});
