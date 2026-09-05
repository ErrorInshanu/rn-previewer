import { View, Text, StyleSheet, TouchableOpacity, TextInput, Image } from 'react-native';

const styles = StyleSheet.create({
  card: {
    width: 220,
    height: 100,
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
  input: {
    height: 32,
    marginTop: 8,
  },
});

const Profile = () => {
  return (
    <View>
      <View style={styles.card}>
        <Image style={styles.avatar} source={{ uri: 'x' }} />
        <Text style={{ color: 'red' }}>shanu singh</Text>
      </View>
      <TouchableOpacity>
        <Text>Follow</Text>
      </TouchableOpacity>
      <TextInput style={styles.input} placeholder="Enter email" />
    </View>
  );
};

export default Profile;