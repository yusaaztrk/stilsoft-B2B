import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, Modal, type StyleProp, type ImageStyle } from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { API_BASE_URL } from '../../shared/config';

interface ImageSliderProps {
  urls: string[];
  imageStyle?: StyleProp<ImageStyle>;
}

export default function ImageSlider({ urls, imageStyle }: ImageSliderProps) {
  const [index, setIndex] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);

  const validUrls = (urls || []).filter(Boolean);

  if (validUrls.length === 0) {
    return null;
  }

  const handlePrev = () => {
    setIndex((prev) => (prev === 0 ? validUrls.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setIndex((prev) => (prev === validUrls.length - 1 ? 0 : prev + 1));
  };

  const currentRawUrl = validUrls[index] || '';
  const currentUri = (currentRawUrl.startsWith('http') || currentRawUrl.startsWith('file') || currentRawUrl.startsWith('content'))
    ? currentRawUrl
    : `${API_BASE_URL}${currentRawUrl}`;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setModalVisible(true)}
        style={styles.touchArea}
      >
        <Image
          source={{ uri: currentUri }}
          style={[styles.image, imageStyle]}
          resizeMode="cover"
        />
      </TouchableOpacity>
      {validUrls.length > 1 && (
        <>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handlePrev}
            style={[styles.arrowBtn, styles.leftBtn]}
          >
            <ChevronLeft color="#fff" size={20} />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleNext}
            style={[styles.arrowBtn, styles.rightBtn]}
          >
            <ChevronRight color="#fff" size={20} />
          </TouchableOpacity>
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1} / {validUrls.length}
            </Text>
          </View>
        </>
      )}

      {/* Fullscreen Zoom Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
        animationType="fade"
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => setModalVisible(false)}
          >
            <X color="#fff" size={24} />
          </TouchableOpacity>

          <Image
            source={{ uri: currentUri }}
            style={styles.fullImage}
            resizeMode="contain"
          />

          {validUrls.length > 1 && (
            <>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handlePrev}
                style={[styles.arrowBtn, styles.leftBtn, styles.modalArrow]}
              >
                <ChevronLeft color="#fff" size={24} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleNext}
                style={[styles.arrowBtn, styles.rightBtn, styles.modalArrow]}
              >
                <ChevronRight color="#fff" size={24} />
              </TouchableOpacity>
              <View style={[styles.counter, styles.modalCounter]}>
                <Text style={styles.counterText}>
                  {index + 1} / {validUrls.length}
                </Text>
              </View>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  touchArea: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  arrowBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  leftBtn: {
    left: 10,
  },
  rightBtn: {
    right: 10,
  },
  counter: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 10,
  },
  counterText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  modalArrow: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginTop: -24,
  },
  modalCounter: {
    bottom: 40,
    right: undefined,
    alignSelf: 'center',
  },
});
