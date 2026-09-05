import { View, Text, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  card: {
    width: 200,
    height: 80,
    backgroundColor: '#4ec9b0',
    borderRadius: 12,
    flexDirection: 'row',
    padding: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
  },
});

const Profile = () => {
  return (
    <View style={styles.card}>
      <View style={styles.avatar} />
      <Text>Hello</Text>
    </View>
  );
};

export default Profile;