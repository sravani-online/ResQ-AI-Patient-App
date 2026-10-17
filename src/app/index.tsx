import React, { useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
const API_URL = 'http://10.190.203.27:3001';
export default function HomeScreen() {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  // Keeps only confirmed speech and prevents repeated final events from duplicating text.
  const finalTranscriptRef = useRef('');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [aiReply, setAiReply] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const conversationModeRef = useRef(false);
  const aiLoadingRef = useRef(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setStarting(false);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setStarting(false);
    // In hands-free mode, send the completed utterance to the AI automatically.
    const spokenMessage = finalTranscriptRef.current.trim();
    if (conversationModeRef.current && spokenMessage && !aiLoadingRef.current) {
      void askResQAI(spokenMessage);
    }
  });
  useSpeechRecognitionEvent('result', (event) => {
    // Only accept confirmed/final results. Interim results often repeat the
    // whole sentence on Android and should not be appended to the transcript.
    console.log('SPEECH RESULT:', JSON.stringify(event));
    

    if (!event.isFinal) return;
    const results = event.results ?? [];
    const resultText = results[0]?.transcript?.replace(/\s+/g, ' ').trim();
    if (!resultText) return;
    const normalize = (value: string) =>
      value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const previous = finalTranscriptRef.current.trim();
    const previousNormalized = normalize(previous);
    const incomingNormalized = normalize(resultText);
    // Ignore exact duplicate final events.
    if (incomingNormalized && incomingNormalized === previousNormalized) {
      setTranscript(previous);
      return;
    }
    // Some Android recognizers send a cumulative result (old words + new words).
    if (previousNormalized && incomingNormalized.startsWith(previousNormalized)) {
      finalTranscriptRef.current = resultText;
      setTranscript(resultText);
      return;
    }
    // Ignore a repeated phrase already contained in the confirmed transcript.
    if (incomingNormalized && previousNormalized.includes(incomingNormalized)) {
      setTranscript(previous);
      return;
    }
    // If the recognizer sends chunks, remove overlapping words at the boundary.
    const previousWords = previous.split(/\s+/).filter(Boolean);
    const incomingWords = resultText.split(/\s+/).filter(Boolean);
    let overlap = 0;
    const maxOverlap = Math.min(previousWords.length, incomingWords.length);
    for (let count = maxOverlap; count > 0; count--) {
      const tail = previousWords.slice(-count).join(' ');
      const head = incomingWords.slice(0, count).join(' ');
      if (normalize(tail) === normalize(head)) {
        overlap = count;
        break;
      }
    }
    const newPart = incomingWords.slice(overlap).join(' ');
    const combined = [previous, newPart].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    finalTranscriptRef.current = combined;
    setTranscript(combined);
  });
  useSpeechRecognitionEvent('error', (event) => {
    console.log('SPEECH ERROR:', JSON.stringify(event));
    setListening(false);
    setStarting(false);
    Alert.alert(
      'Voice recognition issue',
      event.message || 'Could not recognize your speech. Please try again.'
    );
  });
  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
    };
  }, []);
  const askResQAI = async (messageInput?: string) => {
    const message = (messageInput ?? transcript).trim();
    if (!message) {
      Alert.alert('Nothing to send', 'Tap Start Listening and tell ResQ AI what happened first.');
      return;
    }

    try {
      setAiLoading(true);
      aiLoadingRef.current = true;
      setAiReply('');
      Speech.stop();

      const response = await fetch('http://10.190.203.27:3001/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI request failed');
      }
      if (typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('The AI returned an empty reply.');
      }

      const reply = data.reply.trim();
      setAiReply(reply);
      Speech.speak(reply, {
        language: 'en-IN',
        rate: 0.9,
        onDone: () => {
          // Wait until the AI finishes speaking before reopening the microphone.
          if (conversationModeRef.current) {
            setTimeout(() => {
              if (conversationModeRef.current) void startListening();
            }, 350);
          }
        },
        onError: () => {
          Alert.alert('Voice reply unavailable', 'The text reply is available on screen.');
          if (conversationModeRef.current) {
            setTimeout(() => {
              if (conversationModeRef.current) void startListening();
            }, 350);
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect to ResQ AI.';
      Alert.alert(
        'ResQ AI connection issue',
        `${message}\n\nCheck that Ollama and the backend are running, and that your phone and laptop are on the same Wi-Fi.`
      );
      // Keep hands-free mode recoverable after a temporary network/API error.
      if (conversationModeRef.current) {
        setTimeout(() => {
          if (conversationModeRef.current) void startListening();
        }, 700);
      }
    } finally {
      setAiLoading(false);
      aiLoadingRef.current = false;
    }
  };

  const speakReplyAgain = () => {
    if (aiReply.trim()) {
      Speech.stop();
      Speech.speak(aiReply, { language: 'en-IN', rate: 0.9 });
    }
  };

  const startListening = async () => {
    try {
      setStarting(true);
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setStarting(false);
        Alert.alert(
          'Microphone permission needed',
          'Please allow microphone and speech recognition permissions in your phone settings.'
        );
        return;
      }
      setPermissionGranted(true);
      setTranscript('');
      finalTranscriptRef.current = '';
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    } catch (error) {
      setStarting(false);
      setListening(false);
      Alert.alert(
        'Unable to start microphone',
        'Please check microphone permission and try again.'
      );
    }
  };
  const stopListening = () => {
    conversationModeRef.current = false;
    setConversationMode(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
      setStarting(false);
    }
  };
  const toggleConversation = async () => {
    const nextMode = !conversationModeRef.current;
    conversationModeRef.current = nextMode;
    setConversationMode(nextMode);
    if (nextMode) {
      setAiReply('');
      await startListening();
    } else {
      try { ExpoSpeechRecognitionModule.stop(); } catch {}
      Speech.stop();
      setListening(false);
      setStarting(false);
    }
  };
  const openAssistant = () => {
    conversationModeRef.current = false;
    setConversationMode(false);
    setTranscript('');
    setAiReply('');
    finalTranscriptRef.current = '';
    Speech.stop();
    setAssistantOpen(true);
  };
  
const createEmergencyIncident = async () => {
  const id = `EMG-${Date.now()}`;
  let location = null;
/*
  try {
    const permission =
      await Location.requestForegroundPermissionsAsync();

    if (permission.granted) {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
      };
    }
  } catch (error) {
    console.log('Location unavailable:', error);
  }
*/
try {
  console.log('Requesting location permission...');

  const permission =
    await Location.requestForegroundPermissionsAsync();

  console.log('Location permission:', permission.status);

  if (permission.status !== 'granted') {
    console.log('Location permission not granted');
  } else {
    console.log('Fetching GPS coordinates...');

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };

    console.log('GPS location received:', location);
  }
} catch (error) {
  console.log('Location unavailable:', error);
}
  try {
    const response = await fetch(`${API_URL}/incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        summary: 'Emergency assistance requested from mobile app.',
        transcript: [],
        status: 'Needs operator review',
        priority: 'Pending assessment',
        location,
        videoAssessment: '',
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    setIncidentId(data.incident.id);
    console.log('Incident created:', data.incident);
  } catch (error) {
    console.error('Incident submission failed:', error);
    Alert.alert(
      'Incident not sent',
      'Check that the backend is running and the phone and laptop use the same Wi-Fi.'
    );
  }
};
const handleSOS = () => {
  openAssistant();
  void createEmergencyIncident();
};

  const closeAssistant = () => {
    conversationModeRef.current = false;
    setConversationMode(false);
    Speech.stop();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {}
    setListening(false);
    setStarting(false);
    setAssistantOpen(false);
  };
  if (assistantOpen) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.voiceHeader}>
          <TouchableOpacity onPress={closeAssistant}>
            <Text style={styles.back}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.logo}>ResQ AI</Text>
          <Text style={styles.step}>EMERGENCY ASSISTANCE</Text>
        </View>
        <ScrollView contentContainerStyle={styles.voiceContent}>
          <View style={styles.aiCircle}>
            <Text style={styles.micIcon}>🎙️</Text>
          </View>
          <Text style={styles.voiceTitle}>I'm here to help.</Text>
          <Text style={styles.voiceDescription}>
            Are you safe right now? Tell me what happened.
            If you cannot speak, use the silent communication option
            when it is implemented.
          </Text>
          <View
            style={[
              styles.listeningCard,
              listening && styles.activeListeningCard,
            ]}
          >
            <View
              style={[
                styles.pulseDot,
                listening && styles.activeDot,
              ]}
            />
            <Text
              style={[
                styles.listeningText,
                listening && styles.activeListeningText,
              ]}
            >
              {starting
                ? 'Starting microphone...'
                : listening
                ? 'Listening to your voice...'
                : conversationMode
                ? 'Hands-free conversation enabled'
                : permissionGranted
                ? 'Microphone permission granted'
                : 'Voice assistant ready'}
            </Text>
          </View>
          {starting && (
            <ActivityIndicator
              size="small"
              color="#173B70"
              style={{ marginTop: 15 }}
            />
          )}
          <TouchableOpacity
            style={[styles.startButton, conversationMode && styles.conversationActiveButton]}
            onPress={toggleConversation}
            disabled={aiLoading || starting}
          >
            <Text style={styles.startButtonText}>
              {conversationMode ? '⏹ Turn Off Hands-Free Conversation' : '💬 Start Natural Conversation'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.voiceDescription}>
            {conversationMode
              ? 'Hands-free mode is on: speak, wait for ResQ AI to answer, then speak again. Tap the button above to stop.'
              : 'Tap Natural Conversation for automatic replies, or use Start Listening and Ask ResQ AI manually.'}
          </Text>
          <View style={styles.transcriptCard}>
            <Text style={styles.transcriptHeading}>
              WHAT YOU SAID
            </Text>
            <Text style={styles.transcriptText}>
              {transcript || 'Your recognized speech will appear here.'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.askButton}
            //onPress={handleSOS}
            onPress={() => void askResQAI()}
            disabled={aiLoading || listening || starting || !transcript.trim()}
          >
            {aiLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.startButtonText}>✨ Ask ResQ AI</Text>
            )}
          </TouchableOpacity>
          {aiReply ? (
            <View style={styles.aiReplyCard}>
              <Text style={styles.transcriptHeading}>RESQ AI REPLY</Text>
              <Text style={styles.transcriptText}>{aiReply}</Text>
              <TouchableOpacity onPress={speakReplyAgain} style={styles.speakAgainButton}>
                <Text style={styles.retryButtonText}>🔊 Speak reply again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.startButton}
            onPress={startListening}
            disabled={starting || listening || aiLoading}
          >
            <Text style={styles.startButtonText}>
              {starting ? 'Starting...' : '🎙️ Start Listening'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopListening}
            disabled={!listening && !starting}
          >
            <Text style={styles.stopButtonText}>
              Stop Listening
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={startListening}
            disabled={starting || listening}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.silentButton}
            onPress={closeAssistant}
          >
            <Text style={styles.silentButtonText}>
              Return to home
            </Text>
          </TouchableOpacity>
          <Text style={styles.safetyNote}>
            Demo prototype · No emergency service has been contacted.
            In a real emergency in India, call 112 or 108 directly.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>ResQ AI</Text>
            <Text style={styles.subtitle}>
              Intelligent Emergency Assistance
            </Text>
          </View>
          <Text style={styles.ready}>● Ready</Text>
        </View>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>
            Help when you need it most.
          </Text>
          <Text style={styles.welcomeDescription}>
            Start an emergency assistance session with our guided interface.
          </Text>
        </View>
        <View style={styles.sosSection}>
          <Text style={styles.sosTitle}>NEED EMERGENCY HELP?</Text>
          <TouchableOpacity
            style={styles.sosButton}
            activeOpacity={0.8}
            onPress={handleSOS}
          >
            <Text style={styles.sosIcon}>!</Text>
            <Text style={styles.sosText}>SOS</Text>
            <Text style={styles.sosSubtext}>TAP FOR ASSISTANCE</Text>
          </TouchableOpacity>
          <Text style={styles.note}>
            Prototype only — does not contact emergency services.
          </Text>
        </View>
        <Text style={styles.sectionTitle}>Available assistance</Text>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>🎙️</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Voice Assistant</Text>
            <Text style={styles.featureDescription}>
              Speech recognition and voice input
            </Text>
          </View>
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>📍</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Location Sharing</Text>
            <Text style={styles.featureDescription}>
              Location sharing can be connected next
            </Text>
          </View>
        </View>
        <View style={styles.featureCard}>
          <Text style={styles.featureIcon}>📹</Text>
          <View style={styles.featureContent}>
            <Text style={styles.featureTitle}>Silent Communication</Text>
            <Text style={styles.featureDescription}>
              Alternative communication is planned
            </Text>
          </View>
        </View>
        <Text style={styles.footer}>
          In a real emergency in India, call 112 or 108 directly.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },
  content: {
    padding: 20,
    paddingBottom: 35,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 25,
  },
  logo: {
    fontSize: 28,
    fontWeight: '800',
    color: '#173B70',
  },
  subtitle: {
    fontSize: 11,
    color: '#697994',
    marginTop: 4,
  },
  ready: {
    color: '#168451',
    fontSize: 12,
    fontWeight: '700',
  },
  welcomeCard: {
    backgroundColor: '#173B70',
    padding: 22,
    borderRadius: 22,
    marginBottom: 28,
  },
  welcomeTitle: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 10,
  },
  welcomeDescription: {
    color: '#DFE9FA',
    fontSize: 14,
    lineHeight: 22,
  },
  sosSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  sosTitle: {
    color: '#53647D',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 18,
  },
  sosButton: {
    width: 170,
    height: 170,
    borderRadius: 90,
    backgroundColor: '#E53945',
    borderWidth: 8,
    borderColor: '#F9DADD',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 7,
  },
  sosIcon: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
  },
  sosText: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sosSubtext: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  note: {
    color: '#77849A',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 14,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#173B70',
    marginBottom: 15,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 17,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9EEF6',
  },
  featureIcon: {
    fontSize: 26,
    marginRight: 14,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    color: '#203653',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  featureDescription: {
    color: '#748198',
    fontSize: 12,
  },
  footer: {
    color: '#B42332',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 17,
  },
  voiceHeader: {
    padding: 22,
    paddingTop: 12,
  },
  back: {
    color: '#173B70',
    fontSize: 16,
    marginBottom: 22,
  },
  step: {
    color: '#687995',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 8,
  },
  voiceContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 30,
  },
  aiCircle: {
    width: 130,
    height: 130,
    borderRadius: 70,
    backgroundColor: '#DCE9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  micIcon: {
    fontSize: 54,
  },
  voiceTitle: {
    color: '#173B70',
    fontSize: 27,
    fontWeight: '800',
    textAlign: 'center',
  },
  voiceDescription: {
    color: '#65748D',
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 14,
  },
  listeningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E4F7ED',
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 24,
    marginTop: 28,
  },
  activeListeningCard: {
    backgroundColor: '#DCE9FF',
  },
  pulseDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#168451',
    marginRight: 9,
  },
  activeDot: {
    backgroundColor: '#1769D2',
  },
  listeningText: {
    color: '#168451',
    fontWeight: '700',
    fontSize: 13,
  },
  activeListeningText: {
    color: '#173B70',
  },
  transcriptCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E0E8F5',
    padding: 16,
    marginTop: 24,
  },
  transcriptHeading: {
    color: '#687995',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  transcriptText: {
    color: '#203653',
    fontSize: 15,
    lineHeight: 22,
  },
  conversationActiveButton: {
    backgroundColor: '#168451',
  },
  askButton: {
    width: '100%',
    backgroundColor: '#173B70',
    paddingVertical: 15,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  aiReplyCard: {
    width: '100%',
    backgroundColor: '#EEF5FF',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#C8DAF5',
    padding: 16,
    marginTop: 18,
  },
  speakAgainButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 6,
  },
  startButton: {
    width: '100%',
    backgroundColor: '#1769D2',
    paddingVertical: 15,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 22,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  stopButton: {
    width: '100%',
    backgroundColor: '#E53945',
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 12,
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: '#1769D2',
    fontWeight: '700',
    fontSize: 14,
  },
  silentButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#173B70',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  silentButtonText: {
    color: '#173B70',
    fontWeight: '700',
  },
  safetyNote: {
    textAlign: 'center',
    color: '#8490A3',
    fontSize: 10,
    padding: 15,
    lineHeight: 16,
  },
});
