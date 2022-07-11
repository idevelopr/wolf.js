const Base = require('./Base');

class AchievementCategory extends Base {
  constructor (client, data) {
    super(client);

    this.id = data.id;
    this.name = data.name;
  }
}

module.exports = AchievementCategory;
