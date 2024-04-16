const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const router = require("./routes");
const cors = require('cors');
const { default: mongoose, now } = require("mongoose");
const {createMeeting} = require('./api');
const {getUsersByChatRoomId} =  require('./controllers/userController');
const User = require('./models/user');

require("dotenv").config();
const port = process.env.PORT || 3000;
const mongodb_connect_string = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/test';

// Sử dụng cors middleware ở đầu ứng dụng để gg không chặn request
app.use(cors());

// Chuyển đổi dữ liệu sang json và ngược lại
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(router);

// Khởi chạy app
mongoose.connect(mongodb_connect_string)
  .then(() => {
    const server = app.listen(port, () =>
      console.log("> Server is up and running on port : http://localhost:" + port)
    );
    const io = require('socket.io')(server, {
      pingTimeout: 60000,
      cors: {
        origin: '*',
      }
    });
    io.on('connection', (socket) => {
      socket.on('setup', async (userId) => {
        try{
          console.log(userId);
          userId = JSON.parse(userId);
          socket.userId = userId;
          socket.join(userId);
          const user = await User.findById(userId);
          user.isOnline = true;
          await user.save();
          socket.emit('setup', userId);
        } catch(err) {
          console.log(err);
        }
      });
      socket.on("join chat", (room, userId) => {
        userId = JSON.parse(userId);
        socket.join(room);
        socket.emit('join chat', room);
      });
     
      socket.on('message', (message, id) => {
        const newMessage = {
          id: id,
          senderId: JSON.parse(message.senderId),
          content: message.content,
          time: now().getHours() + ':' + now().getMinutes(),
          type: message.type,
          media: message.media,
        }
        console.log('message', newMessage);
        io.to(message.chatRoomId).emit('message', newMessage);
      });

      socket.on('delete message', (message) => {
        console.log('delete message', message);
        io.to(message.chatRoomId).emit('delete message', message);
      });
      
      socket.on('unsend message', (message) => {
        io.to(message.chatRoomId).emit('unsend message', {id: message.messageId});
      });

      socket.on('react message', (message) => {
        io.to(message.chatRoomId).emit('react message', message);
      });
      // socket.on('typing', (data) => {
      //   console.log('typing', data);
      //   io.to(data.chatRoomId).emit('typing', data);
      // });

      // socket.on('stop typing', (data) => {
      //   console.log('stop typing', data);
      //   io.to(data.chatRoomId).emit('stop typing', data);
      // });

      socket.on('disconnect', async () => {
        try{
          console.log('user disconnected', socket.userId);
          const user = await User.findById(socket.userId);
          user.isOnline = false;
          user.lastOnlineTime = Date.now();
          await user.save();
        } catch(err) {
          console.log(err);
        }
      });

      socket.on('call', (chatRoomId) => {
        createMeeting().then((meetingId) => {
          io.to(chatRoomId).emit('call', meetingId);
        });
      });
      // if(!socket.meetingId){
      //   createMeeting().then((meetingId) => {
      //     socket.meetingId = meetingId;
      //     console.log(meetingId)
      //     io.to(room).emit('call', meetingId);
      //   });
      // }
      
      socket.on('notify', async (data) => {
        console.log("Notification", data);
        io.to(data.userId).emit('notify', data);
        // const user = await getUsersByChatRoomId(data.chatRoomId);
        // console.log(user);
        // io.to(data.chatRoomId).emit('notify', data);
      });
      
      socket.on("accept meeting", async (data) => {
        console.log("Accept meeting", data);
        io.to(data.userId).emit('accept meeting', data);
      });

      socket.on("decline", async (data) => {
        console.log("Decline meeting", data);
        io.to(data.userId).emit('decline', data);
      });
    });
  })
  .catch(err =>
    console.log(err));
