import Base from './Base.js';
import StoreSection from './StoreSection.js';

class StorePage extends Base {
  constructor (client, data, languageId) {
    super(client);

    this.id = data.id;
    this.title = data.title;
    this.languageId = languageId;
    this.sections = data.sectionList?.map((section) => new StoreSection(client, section, languageId, true));
  }

  async get (value, offset = 0) {
    const section = (!value && this.sections.length === 1) ? this.sections[0] : this.sections.find((section) => section.id === value || this.client.utility.string.isEqual(section.title, value) || (section.page && this.client.utility.string.isEqual(section?.page, value)) || (section.recipe && section.recipe.id === value));

    return section ? await section.get(offset) : undefined;
  }
}

export default StorePage;
