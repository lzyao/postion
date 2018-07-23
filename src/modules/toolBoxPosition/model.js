/**
 * 所有工具箱最后一次的位置信息
 */
module.exports.mongo = (Schema) => {
  const toolBoxPositionSchema = new Schema({
    RFID: String, // 工具箱唯一ID
    position: {
      longitude: Number,
      latitude: Number
    }, // 定位经纬度
    date: Date, // 定位时间
    address: String, // 定位具体地址
    province: String, // 对应省份
    city: String, // 对应城市
    district: String, // 对应区
    reservePosition: { // 预定位置经纬度
      longitude: Number,
      latitude: Number
    },
    reserveAddress: String, // 预定位置
    reserveDate: Date // 更新预定位置时间
  });
  return ['ToolBoxPosition', toolBoxPositionSchema];
};