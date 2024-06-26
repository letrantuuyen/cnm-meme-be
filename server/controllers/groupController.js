const Group = require('../models/group');
const User = require('../models/user');
const GroupDetail = require('../models/groupDetail');
const ChatRoom = require('../models/chatRoom');
const ApiCode = require("../utils/apicode");
const Roles = require('../utils/rolesEnum');
const {checkPermsOfUserInGroup} = require('../utils/permission');

const apiCode = new ApiCode();

const getGroup = async (req, res) => {
    const id = req.params.id;

    try {
        const group = await Group.findById(id);
        if (!group) {
            return res.status(404).json(apiCode.error('Group not found'));
        }
        return res.status(200).json(apiCode.success(group, 'Get Group Success'));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getGroups = async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId);
    const groupDetails = await GroupDetail.find({ _id: { $in: user.groupDetails } });
    const groups = await Group.find({ _id: { $in: groupDetails.map(groupDetail => groupDetail.groupId) } });
    if(groups.length === 0){
        return res.status(404).json(apiCode.error('Groups not found'));
    }
    else{
        res.status(200).json(apiCode.success(groups, 'Get Groups Success'));
    }
};

const getGroupByGroupDetailId = async (req, res) => {
    const groupDetailId = req.params.groupDetailId;
    const group = await GroupDetail.findById(groupDetailId);
    try{
        const groups = await Group.findById(group.groupId);
        res.status(200).json(apiCode.success(groups, 'Get Group Success'));
    }
    catch (error) {
        res.status(500).json(apiCode.error('Get Group Failed'));
    }
}

const getInfoGroupItem = async (req, res) => {
    try{
        const userId = req.user.id;
        const user = await User.findById(userId);
        const groupDetails = await GroupDetail.find({ _id: { $in: user.groupDetails } });
        const groups = await Group.find({ _id: { $in: groupDetails.map(groupDetail => groupDetail.groupId) } });
        const chatRooms = await ChatRoom.find({ _id: { $in: groups.map(group => group.chatRoomId) } });

        const infoGroupItems = groups.map(group => {
            const chatRoom = chatRooms.find(chatRoom => chatRoom._id.equals(group.chatRoomId));
            return {
                idChatRoom: chatRoom._id,
                groupName: group.name,
                photoURL: group.photoURL,
                lastMessage: chatRoom.lastMessage,
                unreadMessageCount: group.numberOfUnreadMessage
            };
        })
        res.status(200).json(apiCode.success(infoGroupItems, 'Get Info Group Item Success'));
    }catch (error) {
        res.status(500).json({ message: error.message });
    }
}

const getGroupIdsByUserId = async (userId) => {
    const user = await User.findById(userId);
    const groupDetails = await GroupDetail.find({ _id: { $in: user.groupDetails } });
    const groups = await Group.find({ _id: { $in: groupDetails.map(groupDetail => groupDetail.groupId) } });
    return groups.map(group => group._id);
};


const createGroup = async (req, res) => {
  try {
    // Lấy ID của người đăng nhập từ JWT
    const ownerId = req.user.id;
    // Lấy tên của nhóm và danh sách thành viên từ body của yêu cầu
    const { name, members } = req.body;
    // Kiểm tra xem tên nhóm và danh sách thành viên có được cung cấp không
    if (!name || !members || members.length < 2) {
      return res
        .status(400)
        .json(apiCode.error("Tên nhóm và ít nhất hai thành viên là bắt buộc"));
    }
    // Tìm tất cả các nhóm có số lượng thành viên và thành viên giống với nhóm mới
    const existingGroups = await Group.find({
      members: { $size: members.length },
    });
    // Kiểm tra xem có nhóm nào trùng với nhóm mới không
    const duplicateGroup = existingGroups.find((existingGroup) => {
      // So sánh danh sách thành viên của nhóm mới với các nhóm đã tồn tại
      const sortedExistingMembers = existingGroup.members
        .map((member) => member.userId && member.userId.toString())
        .sort();
      const sortedNewMembers = members
        .map((member) => member.userId && member.userId.toString())
        .sort();

      // Kiểm tra xem hai danh sách thành viên có giống nhau không
      return (
        JSON.stringify(sortedExistingMembers) ===
        JSON.stringify(sortedNewMembers)
      );
    });
    if (duplicateGroup) {
      return res.status(400).json(apiCode.error("Nhóm đã tồn tại"));
    }
    // Thêm ownerId vào danh sách thành viên nếu chưa tồn tại
    const updatedMembers = members.map((member) => ({
      _id: member._id,
      userId: member.userId,
      addByUserId: ownerId,
      // Mặc định roles ban đầu là admin cho thành viên và owner cho người tạo
      roles: member.userId === ownerId ? [Roles.OWNER] : [Roles.ADMIN],
      addAt: Date.now(),
    }));

    // Thêm người tạo nhóm vào danh sách thành viên với quyền là "owner"
    updatedMembers.push({
      _id: ownerId,
      userId: ownerId,
      addByUserId: ownerId,
      roles: [Roles.OWNER],
      addAt: Date.now(),
    });

    // Tạo mới chat room
    const chatRoom = new ChatRoom({});
    // Lưu chat room vào cơ sở dữ liệu
    await chatRoom.save();
    // Tạo mới nhóm với thông tin từ yêu cầu và danh sách thành viên đã được cập nhật
    const newGroup = new Group({
      name,
      ownerId,
      members: updatedMembers,
      chatRoomId: chatRoom._id, // Gán chat room ID cho nhóm
    });
    // Lưu nhóm mới vào cơ sở dữ liệu
    await newGroup.save();

    // Trả về phản hồi thành công, loại bỏ các trường "_id"
    res
      .status(201)
      .json(
        apiCode.success(
          newGroup.toJSON({ getters: true }),
          "Nhóm đã được tạo thành công"
        )
      );
  } catch (error) {
    // Xử lý lỗi nếu có
    console.error("Lỗi khi tạo nhóm:", error);
    res.status(500).json(apiCode.error("Đã xảy ra lỗi khi tạo nhóm"));
  }
};


const addMember = async (req, res) => {
  try {
    // Lấy ID của người đăng nhập từ JWT
    const ownerId = req.user.id;
    // Lấy ID của nhóm từ URL
    const groupId = req.params.groupId;

    // Lấy danh sách các thành viên mới từ body của yêu cầu
    const { newMembers } = req.body;

    // Kiểm tra tính hợp lệ của dữ liệu đầu vào
    if (!groupId || !newMembers || newMembers.length === 0) {
      return res
        .status(400)
        .json({
          error: "Vui lòng cung cấp ID nhóm và ít nhất một thành viên mới",
        });
    }

    // Tìm nhóm dựa trên groupId
    const group = await Group.findById(groupId);
    console.log(checkPermsOfUserInGroup(ownerId, group).isOwner());
    console.log(checkPermsOfUserInGroup(ownerId, group).isAdmin());
    console.log(checkPermsOfUserInGroup(ownerId, group).canEditMember());

    // Kiểm tra tính hợp lệ của nhóm
    if (!group) {
      return res.status(404).json({ error: "Không tìm thấy nhóm" });
    }
    // Kiểm tra quyền thêm thành viên vào nhóm
    if (
      checkPermsOfUserInGroup(ownerId, group).isOwner() ||
      checkPermsOfUserInGroup(ownerId, group).isAdmin()
    ) {
      return res
        .status(403)
        .json({ error: "Bạn không có quyền thêm thành viên vào nhóm này" });
    }
    // Lọc các thành viên mới để loại bỏ những thành viên đã tồn tại trong nhóm
    const filteredNewMembers = newMembers.filter((newMember) => {
      return !group.members.some(
        (existingMember) =>
          existingMember.userId.toString() === newMember.userId
      );
    });
    // Thêm các thành viên mới vào nhóm
    filteredNewMembers.forEach((member) => {
      group.members.push({
        userId: member.userId,
        addByUserId: ownerId,
        // MẶc định ban đàu roles là member
        roles: member.roles || [Roles.MEMBER],
        addAt: Date.now(),
      });
    });
    // Kiểm tra xem có thành viên nào được thêm vào không
    if (filteredNewMembers.length === 0) {
      return res
        .status(400)
        .json({ error: "Tất cả các thành viên mới đã tồn tại trong nhóm" });
    }
    // Lưu lại thông tin nhóm đã cập nhật
    // await group.save();
    // Trả về phản hồi thành công
    res
      .status(200)
      .json({ success: true, message: "Thành viên đã được thêm vào nhóm" });
  } catch (error) {
    // Xử lý lỗi nếu có
    console.error("Lỗi khi thêm thành viên vào nhóm:", error);
    res
      .status(500)
      .json({ error: "Đã xảy ra lỗi khi thêm thành viên vào nhóm" });
  }
};
const deleteMember = async (req, res) => {
  try {
    const ownerId = req.user.id; // Lấy ID của người đăng nhập từ JWT
    const groupId = req.params.groupId; // Lấy ID của nhóm từ URL
    const userId = req.body.userId; // Lấy ID của thành viên cần xóa từ body yêu cầu

    // Kiểm tra tính hợp lệ của dữ liệu đầu vào
    if (!groupId || !userId) {
      return res.status(400).json({
        error: "Vui lòng cung cấp ID nhóm và ID thành viên cần xóa",
      });
    }

    // Tìm nhóm dựa trên groupId
    const group = await Group.findById(groupId);

    // Kiểm tra tính hợp lệ của nhóm
    if (!group) {
      return res.status(404).json({ error: "Không tìm thấy nhóm" });
    }

    // Kiểm tra quyền xóa thành viên trong nhóm
    if (
      !checkPermsOfUserInGroup(ownerId, group).isOwner() &&
      !checkPermsOfUserInGroup(ownerId, group).isAdmin() 
    ) {
      return res
        .status(403)
        .json({ error: "Bạn không có quyền xóa thành viên khỏi nhóm này" });
    }

    // Tìm thành viên trong nhóm dựa trên userId
    const memberIndex = group.members.findIndex(
      (member) => member.userId.toString() === userId
    );

    // Kiểm tra tính hợp lệ của thành viên
    if (memberIndex === -1) {
      return res
        .status(404)
        .json({ error: "Không tìm thấy thành viên trong nhóm" });
    }

    // Không cho phép người tạo nhóm xóa chính mình khỏi nhóm
    if (group.members[memberIndex].userId.toString() === ownerId) {
      return res
        .status(403)
        .json({ error: "Bạn không thể xóa chính mình khỏi nhóm" });
    }

    // Xóa thành viên khỏi nhóm
    group.members.splice(memberIndex, 1);

    // Lưu lại thông tin nhóm đã cập nhật
    await group.save();

    // Trả về phản hồi thành công
    res
      .status(200)
      .json({ success: true, message: "Thành viên đã được xóa khỏi nhóm" });
  } catch (error) {
    // Xử lý lỗi nếu có
    console.error("Lỗi khi xóa thành viên khỏi nhóm:", error);
    res
      .status(500)
      .json({ error: "Đã xảy ra lỗi khi xóa thành viên khỏi nhóm" });
  }
};
const outGroup = async (req, res) => {
  try {
    const userId = req.user.id;
    const memberId = req.body.memberId;
    const groupId = req.params.groupId;
    const newOwnerId = req.body.newOwnerId;
    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({ error: "Không tìm thấy nhóm" });
    }

    const permissions = checkPermsOfUserInGroup(userId, group);

    // Kiểm tra nếu owner rời nhóm
    if (
      permissions.isOwner() &&
      permissions.canEditMember() &&
      permissions.canEditGroup()
    ) {
      // Kiểm tra xem đã có yêu cầu chọn owner mới chưa
      if (!newOwnerId) {
        return res
          .status(400)
          .json({ error: "Vui lòng chọn owner mới trước khi rời nhóm" });
      }

      // Kiểm tra xem người được chọn làm owner mới có trong nhóm không
      const newOwner = group.members.find((member) =>
        member.userId.equals(newOwnerId)
      );
      if (!newOwner) {
        return res
          .status(400)
          .json({ error: "Người được chọn không phải là thành viên của nhóm" });
      }

      // Xóa quyền hiện tại của người được chọn và gán quyền owner mới
      newOwner.roles = [Roles.OWNER];

      // Lọc owner ra khỏi danh sách thành viên
      group.members = group.members.filter(
        (member) => !member.userId.equals(userId)
      );

      // Gán quyền owner cho người mới
      group.ownerId = newOwnerId;

      await group.save();
      console.log(memberId, userId, newOwnerId, groupId);

      return res.status(200).json({ message: "Owner đã rời nhóm" });
    }

    const memberIndex = group.members.findIndex(
      (member) => member.userId.toString() === userId
    );

    // Kiểm tra xem thành viên có tồn tại trong nhóm không
    if (memberIndex === -1) { 
      return res
        .status(400)
        .json({ error: "Thành viên không tồn tại trong nhóm" });
    }

    // Xóa thành viên khỏi nhóm
    group.members.splice(memberIndex, 1);

    // Lưu lại thông tin nhóm đã cập nhật
    await group.save();

    if (group.members.length === 1) {
      return res.status(403).json({
        error:
          "Bạn không thể rời khỏi nhóm vì bạn là người dùng cuối cùng trong nhóm",
      });
    }

    res.status(200).json({ success: true, message: "Bạn đã rời khỏi nhóm" });
  } catch (error) {
    console.error("Lỗi khi rời khỏi nhóm:", error);
    res.status(500).json({ error: "Đã xảy ra lỗi khi rời khỏi nhóm" });
  }
};

module.exports = {
    getGroup,
    getGroups,
    getGroupByGroupDetailId,
    getInfoGroupItem,
    getGroupIdsByUserId,
    addMember,
    createGroup,
    deleteMember,
    outGroup
    
};